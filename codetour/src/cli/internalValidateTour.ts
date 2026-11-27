import { promises as fs } from "fs";
import type { Revalidation } from "codetour-tour-generation";

// Post-creation validation of an existing Tour file, for a campaign operator:
// `codetour --internal-validate-tour <tour> [workspace]` re-checks a Tour
// against its workspace with the very rules the creation applied. Those rules
// live once in `codetour-tour-generation` (revalidateTourText), so this
// surface only owns the I/O and the exit contract, mirroring the creation
// commands: stdout carries exactly one JSON document, stderr carries
// diagnostics only.
//   0  the Tour is valid
//   1  the Tour is invalid (schema or anchors)
//   2  usage or IO failure: unreadable Tour file, unusable workspace

export interface ValidationCommandIO {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface ValidationDeps {
  revalidate: (text: string, workspaceRoot: string) => Revalidation;
}

const consoleIO: ValidationCommandIO = {
  out: text => console.log(text),
  err: text => console.error(text),
};

const EXIT_VALID = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function loadDeps(): ValidationDeps {
  // The package is aliased in the CLI bundle and mapped in tsconfig paths,
  // but has no node_modules entry for the compiled test runtime; loading it
  // here keeps this module testable with an injected dependency.
  const { revalidateTourText } = require("codetour-tour-generation") as
    typeof import("codetour-tour-generation");
  return { revalidate: revalidateTourText };
}

/**
 * Revalidate one Tour file against the given workspace root. Prints one JSON
 * document and returns the process exit code (0 valid, 1 invalid, 2 usage).
 */
export async function runInternalValidateTour(
  tourPath: string,
  workspaceRoot: string,
  io: ValidationCommandIO = consoleIO,
  deps: ValidationDeps = loadDeps()
): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(tourPath, "utf8");
  } catch (error) {
    io.err(`CodeTour: Unable to read the Tour file ${tourPath}: ${(error as Error).message}`);
    return EXIT_USAGE;
  }

  let result: Revalidation;
  try {
    result = deps.revalidate(text, workspaceRoot);
  } catch (error) {
    io.err(`CodeTour: internal error: ${(error as Error).message}`);
    return EXIT_USAGE;
  }

  if (result.usageError !== undefined) {
    io.err(`CodeTour: ${result.usageError}`);
    return EXIT_USAGE;
  }

  const document: Record<string, unknown> = {
    ok: result.ok,
    issues: result.issues,
    warnings: result.warnings,
  };
  if (result.title !== undefined) document.title = result.title;
  if (result.stepCount !== undefined) document.stepCount = result.stepCount;
  io.out(JSON.stringify(document));
  return result.ok ? EXIT_VALID : EXIT_INVALID;
}
