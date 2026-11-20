import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInternalOpenVsCode } from "./internalOpenVscode";

/**
 * The non-interactive Open-in-VS Code surface of the composition root
 * (ticket #242 amendment, on the Open-in-VS Code contract of ticket #244):
 * the end-of-generation dialogue of the Pi plugin hands over
 * `codetour --internal-open-vscode <tour> [workspace]`, and this runner
 * reuses the T5 decision module as-is. All seams are faked in-process: the
 * window detection, the `code` reachability and the plan executor are
 * injected; no PTY, no real process, and the Tour file is real so the
 * workspace-relative path of the URI contract is exercised.
 */

function fixture() {
  // The canonical path is the comparison root of the contract (real path).
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codetour-internal-vscode-")));
  mkdirSync(path.join(root, ".tours"), { recursive: true });
  writeFileSync(
    path.join(root, ".tours", "payment.tour"),
    JSON.stringify({
      title: "Payment Flow",
      steps: [{ title: "First", description: "Hi", file: "src/a.ts" }]
    })
  );
  return { root, tour: path.join(root, ".tours", "payment.tour") };
}

function recordingExecution() {
  const invocations: Array<{ command: string; args: string[] }> = [];
  return {
    invocations,
    execution: {
      spawn: async (command: string, args: string[]) => {
        invocations.push({ command, args });
      },
      delay: () => Promise.resolve()
    }
  };
}

test("opens the workspace before sending the Tour URI at the first step", async () => {
  const fixtureData = fixture();
  try {
    const recorded = recordingExecution();
    await runInternalOpenVsCode([fixtureData.tour, fixtureData.root], {
      vscodeAvailable: async () => true,
      execution: recorded.execution
    });
    assert.deepEqual(recorded.invocations, [
      { command: "code", args: [fixtureData.root] },
      {
        command: "code",
        args: [
          "--open-url",
          "vscode://maurice30120.codetour/openTour?tour=.tours%2Fpayment.tour&step=1&workspace=" + encodeURIComponent(fixtureData.root)
        ]
      }
    ]);
  } finally {
    rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test("an unreachable VS Code fails with the defined message", async () => {
  const fixtureData = fixture();
  try {
    const recorded = recordingExecution();
    await assert.rejects(
      runInternalOpenVsCode([fixtureData.tour, fixtureData.root], {
        vscodeAvailable: async () => false,
        execution: recorded.execution
      }),
      /Visual Studio Code is not reachable/
    );
    assert.equal(recorded.invocations.length, 0);
  } finally {
    rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test("a workspace-relative Tour path resolves against the workspace argument", async () => {
  const fixtureData = fixture();
  try {
    const recorded = recordingExecution();
    await runInternalOpenVsCode([".tours/payment.tour", fixtureData.root], {
      vscodeAvailable: async () => true,
      execution: recorded.execution
    });
    assert.match(recorded.invocations[1].args[1], /tour=\.tours%2Fpayment\.tour/);
  } finally {
    rmSync(fixtureData.root, { recursive: true, force: true });
  }
});

test("a missing Tour file fails before any launch", async () => {
  const fixtureData = fixture();
  try {
    const recorded = recordingExecution();
    await assert.rejects(
      runInternalOpenVsCode([path.join(fixtureData.root, ".tours", "absent.tour"), fixtureData.root], {
        vscodeAvailable: async () => true,
        execution: recorded.execution
      }),
      /No existing Tours found|absent\.tour|ENOENT/
    );
    assert.equal(recorded.invocations.length, 0);
  } finally {
    rmSync(fixtureData.root, { recursive: true, force: true });
  }
});
