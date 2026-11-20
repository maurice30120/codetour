import * as assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AcpModelSelector } from "../agent/acpModelOptions";
import type { StepChatResponder } from "../agent/stepChatContract";
import type { CodeTour } from "../store";
import { loadTour } from "../store/tourSchema";
import { NarrationController } from "./narration/NarrationController";
import type { NarrationEngine } from "./narration/SystemSpeech";
import type { ConversationResponder } from "./reader/collaborators";
import { createReader, type TourReader } from "./reader/reader";
import { openTerminalChat, type TerminalChatSession } from "./stepChatSupport";
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

test("the reader can pick an installed agent and its model before sending a question", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-reader-agents-"));
  const firstLog = path.join(root, "copilot.log");
  const selectedLog = path.join(root, "pi.log");
  const fakeAgent = path.join(__dirname, "../agent/fakeAcpAgent.js");
  const chat = openTerminalChat(root, {
    profiles: [["Copilot", firstLog], ["Pi", selectedLog]].map(([name, log]) => ({
      name,
      entry: { command: process.execPath, args: [fakeAgent, log, "model-option"], cwd: root }
    }))
  });
  const reader = createReader({
    tour,
    root,
    speech: new NarrationController({ engine: new MuteSpeechEngine() }),
    descriptionRenderer: async () => "<p>rendered</p>",
    resolveStepContext: () => ({ kind: "none" }),
    responder: composeConversationResponder(chat)
  });
  try {
    await reader.open();
    assert.match(reader.getState().status.hints, /h agent · m model/);
    reader.pressKey({ key: "h" });
    assert.deepEqual(reader.getState().picker?.items.map(item => item.label), ["Copilot", "Pi"]);
    reader.pressKey({ key: "ArrowDown" });
    reader.pressKey({ key: "Enter" });
    assert.equal(reader.getState().conversation.agent?.agent, "Pi");
    assert.equal(existsSync(selectedLog), false);

    reader.pressKey({ key: "m" });
    const deadline = Date.now() + 5_000;
    while (!reader.getState().picker?.items.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(reader.getState().picker?.items.map(item => item.label), ["Fast", "Balanced", "Smart"]);
    assert.doesNotMatch(readFileSync(selectedLog, "utf8"), /session\/prompt/);
    reader.pressKey({ key: "ArrowUp" });
    reader.pressKey({ key: "Enter" });
    await reader.ask("Why?");
    const log = readFileSync(selectedLog, "utf8");
    assert.ok(log.includes("session/set_config_option"));
    assert.ok(log.indexOf("session/set_config_option") < log.indexOf("session/prompt"));
    assert.equal(reader.getState().conversation.agent?.model, "balanced");
    assert.equal(existsSync(firstLog), false);
  } finally {
    await reader.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
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
