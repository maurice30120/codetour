import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTourOpenUri,
  canonicalWorkspacePath,
  detectOpenVsCodeWindows,
  executeOpenInVsCodePlan,
  planOpenInVsCode
} from "./openInVscode";

/**
 * The Open-in-VS Code contract of ticket #244 (spec #239): the terminal
 * reader for Pi and Copilot CLI hands the opening decision to VS Code over
 * the extension's URI contract (`src/extension.ts` URIHandler: a
 * `vscode://maurice30120.codetour` URI whose query carries the Tour file and
 * the 1-based Step), never by pointing `code` at a Tour file blind. The
 * decision logic is pure: the scenarios run in-process, the OS launcher is a
 * recorded fake.
 */

test("canonicalWorkspacePath strips the trailing separator and prefers the real path", () => {
  assert.equal(
    canonicalWorkspacePath("/tmp/link/repo/", () => "/real/repo"),
    "/real/repo"
  );
  // An unavailable real path falls back to the resolved argument, separator
  // stripped, never throwing.
  assert.equal(
    canonicalWorkspacePath("/gone/repo", () => {
      throw new Error("ENOENT");
    }),
    "/gone/repo"
  );
});

test("buildTourOpenUri targets the extension URI handler with a 1-based step", () => {
  // The extension's public-link contract numbers the first Step 1
  // (src/extension.ts startTour); the reader's 0-based active Step maps to it.
  assert.equal(
    buildTourOpenUri({ tourPath: ".tours/onboarding.tour", step: 2 }),
    "vscode://maurice30120.codetour/openTour?tour=.tours%2Fonboarding.tour&step=3"
  );
  // Reserved characters stay isolated to the parameter values, so the query
  // keeps its structure.
  assert.equal(
    buildTourOpenUri({ tourPath: ".tours/tour one&two.tour", step: 0 }),
    "vscode://maurice30120.codetour/openTour?tour=.tours%2Ftour%20one%26two.tour&step=1"
  );
});

test("planOpenInVsCode reports an unavailable VS Code as a defined error", () => {
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: [],
    vscodeAvailable: false
  });
  assert.deepEqual(plan, {
    kind: "unavailable",
    message:
      "Visual Studio Code is not reachable: the 'code' command was not found on PATH."
  });
});

test("planOpenInVsCode opens a new window when the workspace is not open", () => {
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: [],
    vscodeAvailable: true
  });
  // Scenario (b): the folder opens first, then the Tour URI; the URI is the
  // only invocation that carries the Tour, so no window ever opens twice.
  assert.deepEqual(plan, {
    kind: "launch",
    scenario: "new-window",
    invocations: [
      { command: "code", args: ["/repo"] },
      {
        command: "code",
        args: [
          "--open-url",
          "vscode://maurice30120.codetour/openTour?tour=.tours%2Fonboarding.tour&step=3"
        ]
      }
    ]
  });
});

test("planOpenInVsCode reuses the window holding the workspace", () => {
  // Scenario (a): the URI alone reaches the existing window; no folder
  // opening, no duplicate window.
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: ["/repo"],
    vscodeAvailable: true
  });
  assert.deepEqual(plan, {
    kind: "launch",
    scenario: "reuse-window",
    invocations: [
      {
        command: "code",
        args: [
          "--open-url",
          "vscode://maurice30120.codetour/openTour?tour=.tours%2Fonboarding.tour&step=3"
        ]
      }
    ]
  });
});

test("planOpenInVsCode with several windows on the workspace never opens a new one", () => {
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: ["/repo", "/repo"],
    vscodeAvailable: true
  });
  // Defined behavior for several matching windows: the URI alone is sent (VS
  // Code routes it to one of them), and no invocation names the folder, so
  // the plan cannot create a duplicate window.
  assert.equal(plan.kind, "launch");
  assert.ok(plan.kind === "launch");
  assert.equal(plan.scenario, "multiple-windows");
  for (const invocation of plan.invocations) {
    assert.deepEqual(invocation.args, [
      "--open-url",
      "vscode://maurice30120.codetour/openTour?tour=.tours%2Fonboarding.tour&step=3"
    ]);
  }
});

test("executeOpenInVsCodePlan runs the invocations in order and waits between them", async () => {
  const spawned: string[] = [];
  const delays: number[] = [];
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: [],
    vscodeAvailable: true
  });
  await executeOpenInVsCodePlan(plan, {
    spawn: async command => {
      spawned.push(command + " " + (plan.kind === "launch" ? plan.invocations[spawned.length].args.join(" ") : ""));
    },
    delay: async ms => {
      delays.push(ms);
    }
  });
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0], "code /repo");
  assert.ok(spawned[1]!.startsWith("code --open-url"));
  // The settle delay separates the two invocations of the new-window
  // scenario and runs nowhere else.
  assert.deepEqual(delays, [2000]);
});

test("executeOpenInVsCodePlan maps a failed launcher to a defined message", async () => {
  const plan = planOpenInVsCode({
    workspace: "/repo",
    tourPath: ".tours/onboarding.tour",
    step: 2,
    openWindows: [],
    vscodeAvailable: true
  });
  await assert.rejects(
    executeOpenInVsCodePlan(plan, {
      spawn: async () => {
        const error = new Error("spawn code ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      },
      delay: async () => undefined
    }),
    /Visual Studio Code is not reachable/
  );
});

test("detectOpenVsCodeWindows decodes the workspace folders of running windows", async () => {
  const seen: string[] = [];
  const windows = await detectOpenVsCodeWindows({
    storageRoot: "/support/Code/User/workspaceStorage",
    listDirectories: async root => {
      seen.push(root);
      return ["hash-one", "hash-two", "hash-three"];
    },
    readFile: async filePath => {
      if (filePath.endsWith("hash-two/workspace.json")) {
        // A corrupt storage entry is ignored: best-effort detection.
        return "{not json";
      }
      return filePath.endsWith("hash-one/workspace.json")
        ? JSON.stringify({ folder: "file:///repo" })
        : JSON.stringify({ folder: "file:///gone%20repo" });
    }
  });
  assert.deepEqual(seen, ["/support/Code/User/workspaceStorage"]);
  assert.deepEqual(windows, ["/repo", "/gone repo"]);
});
