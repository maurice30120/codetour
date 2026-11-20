import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { AcpModelSelector } from "../agent/acpModelOptions";
import type { StepChatResponder } from "../agent/stepChatContract";
import type { CodeTour } from "../store";
import { loadTour } from "../store/tourSchema";
import { NarrationController } from "./narration/NarrationController";
import type { NarrationEngine } from "./narration/SystemSpeech";
import type { ConversationResponder } from "./reader/collaborators";
import { createReader, type TourReader } from "./reader/reader";
import type { TerminalChatSession } from "./stepChatSupport";
import { composeConversationResponder } from "./terminal";

/**
 * The composition root's adaptation of the terminal's Step Chat responder to
 * the reader's `ConversationResponder` port (spec #93, ticket #266 review):
 * the model picker must exist exactly when the answering agent accepts a model
 * change, a decision taken here — in the composition the CLI entry point
 * performs — and nowhere else. Faked at the transport seam: no agent process,
 * no PTY.
 */

const tour: CodeTour = loadTour(
  JSON.stringify({
    title: "Composition",
    steps: [{ file: "src/a.ts", line: 1, description: "Only Step" }]
  }),
  "file:///repo/.tours/composition.tour"
);

/** The selector an open session announces. */
const selector: AcpModelSelector = {
  optionId: "model",
  value: "smart",
  values: [
    { value: "fast", name: "Fast" },
    { value: "smart", name: "Smart" }
  ]
};

/** The engine fake the narration controller composes over, like the reader suite's. */
class MuteSpeechEngine implements NarrationEngine {
  dispose(): void {}
  cancel(): void {}
  async speak(): Promise<void> {}
}

function chatSession(responder?: StepChatResponder): TerminalChatSession {
  return {
    profile: { name: "Copilot", entry: { command: "copilot", cwd: "/repo" } },
    responder,
    dispose: async () => undefined
  };
}

/** A reader over the port the composition produced, as the entry point builds it. */
function readerOver(responder: ConversationResponder | undefined): TourReader {
  return createReader({
    tour,
    root: "/repo",
    speech: new NarrationController({ engine: new MuteSpeechEngine() }),
    descriptionRenderer: async () => "<p>rendered</p>",
    resolveStepContext: () => ({ kind: "none" }),
    responder
  });
}

test("the composed responder exposes a model change when the answering agent accepts one", async () => {
  const requested: string[] = [];
  const port = composeConversationResponder(chatSession({
    answer: () => "Fake answer",
    identity: () => ({ agent: "Copilot", model: "smart", effective: true }),
    model: () => selector,
    selectModel: value => {
      requested.push(value);
    }
  }));
  assert.ok(port, "a session with a responder is adapted");
  assert.deepEqual(port.model?.(), selector, "the announced selector travels unchanged");
  await port.selectModel?.("fast");
  assert.deepEqual(requested, ["fast"], "the request reaches the transport");
  // The reader's `m` key and its hint exist exactly then (ticket #266).
  const reader = readerOver(port);
  await reader.open();
  assert.ok(reader.wouldConsume({ key: "m" }), "the composed reader serves the picker");
  assert.ok(reader.getState().status.hints.includes("m model"),
    "and advertises the key: " + reader.getState().status.hints);
  reader.pressKey({ key: "m" });
  assert.equal(reader.getState().picker?.items.length, 2,
    "the picker lists the announced models");
  await reader.close();
});

test("an agent that manages its own model leaves the composed reader without a picker", async () => {
  const port = composeConversationResponder(chatSession({
    answer: () => "Fake answer",
    identity: () => ({ agent: "Copilot", effective: true })
  }));
  assert.ok(port, "the session is still adapted: questions keep working");
  assert.equal(port.selectModel, undefined,
    "no model request is invented for an agent that accepts none");
  assert.equal(port.model?.(), undefined);
  // Through the real composition the reader's guard is reachable: `m` stays
  // terminal-owned and the hint is never shown.
  const reader = readerOver(port);
  await reader.open();
  assert.ok(!reader.wouldConsume({ key: "m" }), "the terminal keeps the key");
  assert.ok(!reader.getState().status.hints.includes("m model"),
    "no hint for a key the reader does not take: " + reader.getState().status.hints);
  await reader.close();
  // No installed Agent Profile at all: no responder, and no port either.
  assert.equal(composeConversationResponder(chatSession()), undefined);
});
