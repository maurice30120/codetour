import { promises as fs } from "fs";
import { createChangesTour, createContext, createProjectTour } from "codetour-tour-generation";
import type { CreationFailure, CreationResult, TourKind } from "codetour-tour-generation";

// Tour creation from the command line: an agent hands over its JSON proposal
// and gets one JSON result. The business rules live in the shared
// `codetour-tour-generation` package, so this surface applies the same
// validation, the same confinement and the same atomic write as every caller.
//
// Output contract (DESIGN §2): stdout carries exactly one JSON document,
// stderr carries diagnostics only, and the exit code says how to react.
//   0  the Tour was created
//   1  the proposal, the validation or the creation failed; a failure
//      document is printed, never a success one
//   2  usage or IO failure: missing or unknown argument, unusable workspace,
//      unreadable proposal file

export interface CreationCommandIO {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleIO: CreationCommandIO = {
  out: text => console.log(text),
  err: text => console.error(text),
};

const EXIT_CREATED = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

// A usage or IO failure: the command line itself is unusable, so nothing was
// attempted and no result document exists.
class CreationUsageError extends Error {}

// The proposal was read but is not JSON: the call was well formed, its content
// is not.
class ProposalSyntaxError extends Error {}

interface CreationArguments {
  help: boolean;
  workspace?: string;
  proposal?: string;
}

function commandName(kind: TourKind): string {
  return `create-${kind}-tour`;
}

function usage(kind: TourKind): string {
  const tourName = kind === "project" ? "Project Tour" : "Changes Tour";
  return [
    `Usage: codetour ${commandName(kind)} --workspace <dir> [--proposal <file|->]`,
    "",
    `Create a CodeTour ${tourName} from a JSON proposal.`,
    "",
    "Options:",
    "  --workspace <dir>    workspace root the Tour is created in (required)",
    "  --proposal <file|->  JSON proposal file, or - for standard input (default)",
    "  -h, --help           show this help",
    "",
    "The result is one JSON document on stdout; diagnostics go to stderr.",
    "Exit codes: 0 created, 1 proposal or creation refused, 2 usage or IO failure.",
  ].join("\n");
}

// The arguments are parsed here rather than by the option framework: the
// creation commands own their exit codes and their diagnostics, and the reader
// keeps its own single error contract.
function parseArguments(argv: string[]): CreationArguments {
  const parsed: CreationArguments = { help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (argument === "--workspace" || argument === "--proposal") {
      const value = argv[index + 1];
      // A lone "-" is a value (standard input), never an option.
      if (value === undefined || (value.startsWith("-") && value !== "-")) {
        throw new CreationUsageError(`Missing value for ${argument}.`);
      }
      if (argument === "--workspace") {
        parsed.workspace = value;
      } else {
        parsed.proposal = value;
      }
      index++;
    } else if (argument.startsWith("--workspace=") || argument.startsWith("--proposal=")) {
      const separator = argument.indexOf("=");
      const value = argument.slice(separator + 1);
      if (value.trim() === "") {
        throw new CreationUsageError(`Missing value for ${argument.slice(0, separator)}.`);
      }
      if (argument.startsWith("--workspace=")) {
        parsed.workspace = value;
      } else {
        parsed.proposal = value;
      }
    } else if (argument.startsWith("-") && argument !== "-") {
      throw new CreationUsageError(`Unknown option: ${argument}.`);
    } else {
      throw new CreationUsageError(`Unexpected argument: ${argument}.`);
    }
  }
  if (!parsed.help && parsed.workspace === undefined) {
    throw new CreationUsageError("Missing required option: --workspace <dir>.");
  }
  return parsed;
}

// The workspace is an explicit argument on every creation: the creation rules
// canonicalize it, and an unusable directory is a usage failure rather than a
// rejected proposal.
function resolveWorkspace(value: string): string {
  try {
    return createContext(value).root;
  } catch {
    throw new CreationUsageError(`--workspace is not an accessible directory: ${value}`);
  }
}

function readStandardInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

async function readProposalText(source: string | undefined): Promise<string> {
  if (source === undefined || source === "-") {
    // Reading a terminal would block until the user types an end of file;
    // say what is missing instead of appearing to hang.
    if (process.stdin.isTTY) {
      throw new CreationUsageError(
        "No proposal on standard input; pass --proposal <file> or pipe the JSON proposal."
      );
    }
    return readStandardInput();
  }
  try {
    return await fs.readFile(source, "utf8");
  } catch (error) {
    throw new CreationUsageError(
      `Unable to read the proposal file ${source}: ${(error as Error).message}`
    );
  }
}

async function readProposal(source: string | undefined): Promise<unknown> {
  const text = await readProposalText(source);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProposalSyntaxError(`The proposal is not valid JSON: ${(error as Error).message}`);
  }
}

function create(kind: TourKind, workspaceRoot: string, proposal: unknown): Promise<CreationResult> {
  const options = { workspaceRoot, proposal, surface: commandName(kind) };
  return kind === "project" ? createProjectTour(options) : createChangesTour(options);
}

function failureDocument(failure: CreationFailure): Record<string, unknown> {
  return {
    ok: false,
    code: failure.code,
    message: failure.message,
    ...(failure.issues !== undefined ? { issues: failure.issues } : {}),
  };
}

function reportFailure(io: CreationCommandIO, failure: CreationFailure): void {
  io.err(`CodeTour: creation refused (${failure.code}): ${failure.message}`);
  for (const issue of failure.issues ?? []) {
    io.err(`CodeTour: ${issue.path}: ${issue.message}`);
  }
}

// Run one creation command. Returns the process exit code; nothing is written
// to stdout except the single result document.
export async function runCreateTourCommand(
  kind: TourKind,
  argv: string[],
  io: CreationCommandIO = consoleIO
): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    if (parsed.help) {
      io.out(usage(kind));
      return EXIT_CREATED;
    }
    const workspaceRoot = resolveWorkspace(parsed.workspace as string);
    const proposal = await readProposal(parsed.proposal);
    const result = await create(kind, workspaceRoot, proposal);
    if (!result.ok) {
      io.out(JSON.stringify(failureDocument(result)));
      reportFailure(io, result);
      return EXIT_REFUSED;
    }
    io.out(
      JSON.stringify({
        ok: true,
        kind: result.kind,
        tourPath: result.tourPath,
        title: result.title,
        stepCount: result.stepCount,
        warnings: result.warnings,
      })
    );
    return EXIT_CREATED;
  } catch (error) {
    if (error instanceof CreationUsageError) {
      io.err(`CodeTour: ${error.message}`);
      io.err(usage(kind));
      return EXIT_USAGE;
    }
    if (error instanceof ProposalSyntaxError) {
      const failure: CreationFailure = {
        ok: false,
        code: "INVALID_PROPOSAL",
        message: error.message,
      };
      io.out(JSON.stringify(failureDocument(failure)));
      reportFailure(io, failure);
      return EXIT_REFUSED;
    }
    throw error;
  }
}
