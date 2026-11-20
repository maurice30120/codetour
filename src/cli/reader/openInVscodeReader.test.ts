import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeTour } from "../../store";
import { loadTour } from "../../store/tourSchema";
import { NarrationController } from "../narration/NarrationController";
import type { NarrationEngine } from "../narration/SystemSpeech";
import { createReader, type TourReader } from "./reader";
import { statusLine } from "./statusLine";
import type { ConversationResponder } from "./collaborators";
import type { OpenInVsCodeRequest } from "../openInVscode";

/**
 * The Open-in-VS Code reading behavior of ticket #244 (spec #239): the
 * reader turns the unmodified `o` key into one collaborator request carrying
 * the view model's facts — the Tour identity, the workspace root and the
 * active Step — and surfaces a nonblocking failure on its status line. The
 * invoker is faked at the module boundary; no OS process is started.
 */

const tour: CodeTour = loadTour(
  JSON.stringify({
    title: "Onboarding",
    steps: [
      { file: "src/a.ts", line: 1, description: "First" },
      { file: "src/b.ts", line: 2, description: "Second" }
    ]
  }),
  "file:///repo/.tours/onboarding.tour"
);

/** The engine fake the narration controller composes over, like the reader suite's. */
class MuteSpeechEngine implements NarrationEngine {
  dispose(): void {}
  cancel(): void {}
  async speak(): Promise<void> {}
}

class ScriptedOpenInVsCode {
  readonly requests: OpenInVsCodeRequest[] = [];
  private readonly settlements: Array<(error?: Error) => void> = [];

  get invoker() {
    return async (request: OpenInVsCodeRequest): Promise<void> => {
      this.requests.push(request);
      return new Promise<void>((resolve, reject) => {
        this.settlements.push((error?: Error) => (error ? reject(error) : resolve()));
      });
    };
  }

  settle(index: number, error?: Error): void {
    this.settlements[index]?.(error);
  }
}

function harness(
  openInVsCode?: ScriptedOpenInVsCode["invoker"],
  responder?: ConversationResponder
): TourReader {
  return createReader({
    tour,
    root: "/repo",
    speech: new NarrationController({ engine: new MuteSpeechEngine() }),
    // No Git command and no file read in this suite: a plain "none" context
    // and an immediate description render.
    descriptionRenderer: async () => "<p>rendered</p>",
    resolveStepContext: () => ({ kind: "none" }),
    responder,
    openInVsCode
  });
}

async function flushed(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve));
}

test("`o` opens the Tour in VS Code at the active Step over the reader contract", async () => {
  const collaborator = new ScriptedOpenInVsCode();
  const reader = harness(collaborator.invoker);
  await reader.open();
  reader.navigateTo(1);
  reader.pressKey({ key: "o" });
  await flushed();
  assert.deepEqual(collaborator.requests, [
    // The Tour identity is the discovery-assigned file URI, not the title.
    {
      tourId: "file:///repo/.tours/onboarding.tour",
      workspaceRoot: "/repo",
      step: 1
    }
  ]);
  await reader.close();
});

test("the reader consumes `o` only when the Open-in-VS Code collaborator exists", () => {
  const reader = harness();
  assert.ok(!reader.wouldConsume({ key: "o" }), "without the collaborator the key stays terminal-owned");
  const collaborator = new ScriptedOpenInVsCode();
  const wired = harness(collaborator.invoker);
  assert.ok(wired.wouldConsume({ key: "o" }));
  // Modified keys are never the opening shortcut.
  assert.ok(!wired.wouldConsume({ key: "o", ctrl: true }));
  assert.ok(!wired.wouldConsume({ key: "o", meta: true }));
  assert.ok(!wired.wouldConsume({ key: "o", alt: true }));
  void reader.close();
  void wired.close();
});

test("a failing VS Code opening becomes a nonblocking status-line warning", async () => {
  const collaborator = new ScriptedOpenInVsCode();
  const reader = harness(collaborator.invoker);
  await reader.open();
  reader.pressKey({ key: "o" });
  await flushed();
  collaborator.settle(0, new Error("boom"));
  await flushed();
  const segments = reader.getState().status.rightSegments;
  assert.ok(
    segments.some(segment => segment.startsWith("vscode: ") && segment.includes("boom")),
    "the status line shows the opening failure: " + JSON.stringify(segments)
  );
  // A later success clears the stale warning.
  reader.pressKey({ key: "o" });
  await flushed();
  collaborator.settle(1);
  await flushed();
  assert.ok(
    !reader.getState().status.rightSegments.some(segment => segment.startsWith("vscode: ")),
    "a successful opening clears the warning"
  );
  await reader.close();
});

test("the open warning sits after the documented fixed precedence segments (spec #240)", () => {
  // The precedence is fixed: voice, speech warning, provider, exchange
  // count — the Open-in-VS Code warning takes the last, outermost slot
  // (spec #239 review F3), so a narrow terminal cuts it first and the
  // documented segments stay in order.
  const status = statusLine({
    conversation: { asking: false, responding: false, hasResponder: true },
    compactHints: false,
    narrationEnabled: true,
    speechWarning: "voice: slow",
    canOpenInVsCode: true,
    openWarning: "vscode: boom",
    providerName: "Fake",
    exchangeCount: 2
  });
  assert.deepEqual(status.rightSegments, [
    "VOICE ON", "voice: slow", "fake", "2 exchanges", "vscode: boom"
  ]);
  // The warning survives the exchange-count-abent case unplaced before the
  // provider.
  const bare = statusLine({
    conversation: { asking: false, responding: false, hasResponder: false },
    compactHints: true,
    narrationEnabled: false,
    speechWarning: undefined,
    canOpenInVsCode: true,
    openWarning: "vscode: boom",
    providerName: undefined,
    exchangeCount: 0
  });
  assert.deepEqual(bare.rightSegments, ["VOICE OFF", "vscode: boom"]);
});

test("a failing opening never lands between the voice warning and the provider in the live view model", async () => {
  const collaborator = new ScriptedOpenInVsCode();
  const responder: ConversationResponder = {
    providerName: "Fake",
    answer: async () => "Fake answer"
  };
  const reader = harness(collaborator.invoker, responder);
  await reader.open();
  reader.pressKey({ key: "o" });
  await flushed();
  collaborator.settle(0, new Error("boom"));
  await flushed();
  await reader.ask("why?");
  const segments = reader.getState().status.rightSegments;
  const openIndex = segments.findIndex(segment => segment.startsWith("vscode: "));
  const exchangeIndex = segments.findIndex(segment => /exchange/.test(segment));
  assert.ok(openIndex > exchangeIndex,
    "the open warning is cut before the exchange count: " + JSON.stringify(segments));
  await reader.close();
});

test("the `o` shortcut is not taken in ask mode", async () => {
  const collaborator = new ScriptedOpenInVsCode();
  // A responder is wired so `a` owns the keyboard: without one, `a` itself
  // never enters ask mode and the test would prove nothing.
  const responder: ConversationResponder = {
    providerName: "Fake",
    answer: async () => "Fake answer"
  };
  const reader = harness(collaborator.invoker, responder);
  await reader.open();
  // An `o` typed in the ask prompt stays draft text.
  reader.pressKey({ key: "a" });
  reader.pressKey({ key: "o" });
  assert.deepEqual(collaborator.requests, []);
  assert.ok(reader.getState().composer.draft.includes("o"));
  await reader.close();
});
