import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createContext } from "./context";
import { OutputPathError, writeTourAtomic } from "./persistence";
import { validateCodetourTour } from "./codetour-schema";
import {
  ErrorResult,
  Issue,
  SuccessResult,
  TourFile,
  TourStep,
  Warning,
  WorkspaceContext,
} from "./types";
import {
  MAX_RECOMMENDED_STEPS,
  validateSteps,
  validateTourParams,
} from "./validation";
import {
  MERMAID_TOOL_GUIDANCE,
  validateMermaidDescriptions,
} from "./mermaid-validation";
import packageJson from "../package.json";

// Point de passage unique entre l'agent IA (Tour Generator) et CodeTour :
// l'agent choisit le sujet du Tour, analyse lui-même l'état du workspace —
// Git ou autre — et fournit le nom du fichier de sortie. Le serveur ne conserve
// que les responsabilités de validation, de sécurité et de persistance.
//
// Le schéma d'entrée de l'outil reste volontairement permissif
// (`z.unknown()` + `.passthrough()`) : le SDK MCP rejette lui-même les arguments
// qui ne correspondent pas à un schéma strict, ce qui casserait l'exigence
// d'agréger toutes les erreurs de validation dans une seule réponse. La
// validation complète, champ par champ, est donc effectuée dans validation.ts.

const CODETOUR_SCHEMA_URI = "https://aka.ms/codetour-schema";
const SERVER_NAME = "codetour-mcp";
const SERVER_VERSION = packageJson.version;

const TOURS_DIRECTORY = ".tours";

const MARKDOWN_WRITING_GUIDANCE =
  "Write the Tour-level description and every step description as readable Markdown. " +
  "Split distinct ideas into short paragraphs separated by blank lines. Use a short " +
  "heading when a description covers multiple topics, and use bullet or numbered lists " +
  "for collections, alternatives, or sequences. Use **bold** sparingly for important " +
  "concepts and backticks for code identifiers. Avoid dense monolithic paragraphs, and " +
  "keep each explanation concise and tied to the current Tour Anchor. Do not add " +
  "structure mechanically: a short, single-purpose description may remain one paragraph. ";

const CREATE_TOUR_DESCRIPTION =
  "Creates a CodeTour Tour from a fully written proposal and persists it under " +
  "`.tours/<fileName>`, atomically replacing any existing file with that name. " +
  "You choose the Tour's subject, analyze the relevant workspace state yourself (Git " +
  "or otherwise), and provide the output file name; the server only validates and " +
  "persists the proposal deterministically. It performs no Git access and never writes " +
  "a CodeTour `ref` property. " +
  "Arguments: `fileName` (required bare file name ending in `.tour`, no path separators, " +
  "no `.`/`..`, no absolute path), `title` (required non-empty string), an optional " +
  "description, and a required non-empty `steps` array. Each step takes an optional " +
  "title, a required Markdown description, and at most one locator: a file or a " +
  "directory (workspace-relative paths). A step may also target a line, a unique " +
  "stable pattern, or a selection, but only together with a file; line and pattern are " +
  "mutually exclusive. Prefer a unique stable pattern over a line number so the anchor " +
  "resists file evolution, and use a line only as a fallback. Steps without any locator " +
  "are allowed for general context. Every anchor is validated against the real " +
  "workspace state, and all validation errors are reported in a single response. On " +
  "failure, the previous tour file is preserved. " +
  MARKDOWN_WRITING_GUIDANCE +
  MERMAID_TOOL_GUIDANCE;

const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
const issueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
const toolResultSchema = z.object({
  status: z.enum(["created", "error"]),
  path: z.string().optional(),
  stepCount: z.number().int().nonnegative().optional(),
  warnings: z.array(warningSchema).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  issues: z.array(issueSchema).optional(),
});

const tourToolInputSchema = z
  .object({
    fileName: z.unknown().optional(),
    title: z.unknown().optional(),
    description: z
      .unknown()
      .optional()
      .describe(
        "Optional readable Markdown overview; follow the Markdown writing guidance in the tool description."
      ),
    steps: z
      .unknown()
      .optional()
      .describe(
        "Non-empty array whose descriptions are concise, structured Markdown tied to their Tour Anchors."
      ),
  })
  .passthrough();

export function createServer(workspaceRoot: string): McpServer {
  const ctx = createContext(workspaceRoot);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "create_tour",
    {
      description: CREATE_TOUR_DESCRIPTION,
      inputSchema: tourToolInputSchema,
      outputSchema: toolResultSchema,
    },
    (args) => handleCreateTour(ctx, args)
  );

  return server;
}

// Valide puis persiste la proposition de Tour. Aucune logique Git n'est
// effectuée ici : le serveur ne connaît ni le sujet, ni la référence éventuelle
// du Tour, qui relèvent exclusivement des instructions du Tour Generator.
async function handleCreateTour(
  ctx: WorkspaceContext,
  args: unknown
): Promise<ToolResponse> {
  const rawSteps = extractSteps(args);
  // La validation agrège toutes les erreurs (paramètres puis étapes) avant de
  // répondre, pour permettre à l'agent de corriger la proposition en un cycle.
  const { params, issues: paramIssues } = validateTourParams(args);
  const mermaidIssues = await validateMermaidDescriptions(args);
  if (rawSteps === undefined || (Array.isArray(rawSteps) && rawSteps.length === 0)) {
    if (mermaidIssues.length === 0) {
      return errorResponse("TOUR_STEPS_REQUIRED", "A tour requires at least one step.");
    }

    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_tour arguments are invalid.",
      [
        ...mermaidIssues,
        { path: "steps", message: "is required and must contain at least one step" }
      ]
    );
  }

  const allIssues = [...paramIssues, ...mermaidIssues];
  let steps: TourStep[] | undefined;
  if (Array.isArray(rawSteps)) {
    const validated = validateSteps(rawSteps, ctx);
    steps = validated.steps;
    allIssues.push(...validated.issues);
  }
  if (!params || allIssues.length > 0) {
    return errorResponse(
      "INVALID_PROPOSAL",
      "The create_tour arguments are invalid.",
      allIssues
    );
  }
  const finalSteps = steps as TourStep[];

  const warnings = stepLimitWarnings(finalSteps);

  const tour: TourFile = {
    $schema: CODETOUR_SCHEMA_URI,
    title: params.title,
    ...(params.description !== undefined ? { description: params.description } : {}),
    steps: finalSteps,
  };

  const relativePath = `${TOURS_DIRECTORY}/${params.fileName}`;
  const writeFailure = await persistTour(ctx, relativePath, tour);
  if (writeFailure) {
    return writeFailure;
  }

  return successResponse(
    relativePath,
    finalSteps.length,
    warnings,
    `Created Tour at ${relativePath} with ${finalSteps.length} step(s).`
  );
}

// Avertissement non bloquant lorsqu'un Tour dépasse quinze étapes.
function stepLimitWarnings(steps: TourStep[]): Warning[] {
  if (steps.length <= MAX_RECOMMENDED_STEPS) {
    return [];
  }
  return [
    {
      code: "STEP_LIMIT_EXCEEDED",
      message: `The tour has ${steps.length} steps; the recommended maximum is ${MAX_RECOMMENDED_STEPS}.`,
    },
  ];
}

// Valide le Tour produit contre le schéma CodeTour général, puis l'écrit de
// façon atomique. En cas d'échec, l'ancien fichier reste intact.
async function persistTour(
  ctx: WorkspaceContext,
  relativePath: string,
  tour: TourFile
): Promise<ToolResponse | null> {
  const schemaResult = validateCodetourTour(tour);
  if (!schemaResult) {
    return errorResponse(
      "SCHEMA_VALIDATION_FAILED",
      "The generated tour did not validate against the CodeTour schema.",
      []
    );
  }
  try {
    await writeTourAtomic(ctx, relativePath, serializeTour(tour));
  } catch (error) {
    if (error instanceof OutputPathError) {
      return errorResponse("OUTPUT_PATH_ESCAPES_WORKSPACE", error.message);
    }
    throw error;
  }
  return null;
}

function extractSteps(args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  return (args as Record<string, unknown>).steps;
}

function serializeTour(tour: TourFile): string {
  return JSON.stringify(tour, null, 2) + "\n";
}

interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function successResponse(
  relativePath: string,
  stepCount: number,
  warnings: Warning[],
  message: string
): ToolResponse {
  const result: SuccessResult = {
    status: "created",
    path: relativePath,
    stepCount,
    warnings,
  };
  const text = [
    message,
    ...warnings.map((warning) => `Warning (${warning.code}): ${warning.message}`),
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function errorResponse(
  code: string,
  message: string,
  issues?: Issue[]
): ToolResponse {
  const result: ErrorResult = {
    status: "error",
    code,
    message,
    ...(issues && issues.length > 0 ? { issues } : {}),
  };
  const text =
    issues && issues.length > 0
      ? `Error (${code}): ${message}\n` +
        issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")
      : `Error (${code}): ${message}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: true,
  };
}
