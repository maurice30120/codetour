import { validateCodetourTour } from "./codetour-schema";
import { createContext } from "./context";
import { orientationStepWarnings, validateSteps } from "./validation";
import type { Issue, TourStep, Warning } from "./types";

// Post-creation validation of an existing Tour document: the same schema and
// anchor rules the creation applied, re-run against the current workspace.
// A campaign operator re-checks a Tour this way instead of re-deriving the
// rules by hand — in particular the whole-file pattern contract, which a
// line-by-line check gets wrong on multi-line patterns.

export interface Revalidation {
  ok: boolean;
  /** Set when nothing could be attempted because the workspace is unusable. */
  usageError?: string;
  title?: string;
  stepCount?: number;
  issues: Issue[];
  warnings: Warning[];
}

function schemaIssues(errors: ReadonlyArray<{ instancePath?: string; message?: string }>): Issue[] {
  return errors.map(error => ({
    path: error.instancePath || "$",
    message: error.message ?? "does not satisfy the CodeTour schema",
  }));
}

/**
 * Revalidate the text of a Tour file against the given workspace root, never
 * throwing: a malformed document is an invalid Tour, and an unusable
 * workspace is reported through `usageError` so the caller can refuse the
 * command line instead of the Tour.
 */
export function revalidateTourText(text: string, workspaceRoot: string): Revalidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: "$", message: `is not valid JSON: ${(error as Error).message}` }],
      warnings: [],
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "$", message: "is not a Tour object" }], warnings: [] };
  }
  const tour = raw as Record<string, unknown>;

  // The workspace is where the anchors resolve; an unusable directory is a
  // usage failure rather than a rejected Tour.
  let context;
  try {
    context = createContext(workspaceRoot);
  } catch (error) {
    return {
      ok: false,
      usageError: `the workspace is unusable: ${(error as Error).message}`,
      issues: [],
      warnings: [],
    };
  }

  // The schema the creation guarantees for its own output, re-applied.
  if (!validateCodetourTour(raw)) {
    return {
      ok: false,
      issues: schemaIssues(validateCodetourTour.errors ?? []),
      warnings: [],
    };
  }

  const steps = Array.isArray(tour.steps) ? tour.steps : [];
  const { issues } = validateSteps(steps, context);
  if (issues.length > 0) {
    return { ok: false, issues, warnings: [] };
  }

  return {
    ok: true,
    title: typeof tour.title === "string" ? tour.title : undefined,
    stepCount: steps.length,
    issues: [],
    warnings: orientationStepWarnings(steps as TourStep[]),
  };
}
