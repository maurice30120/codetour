import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeTour } from "../../store";
import { loadTour } from "../../store/tourSchema";
import type { AcpModelSelector } from "../../agent/acpModelOptions";
import type { StepChatAgentIdentity } from "../../agent/stepChatContract";
import { NarrationController } from "../narration/NarrationController";
import type { NarrationEngine } from "../narration/SystemSpeech";
import type { ConversationResponder } from "./collaborators";
import { createReader, type TourReader } from "./reader";
import { statusLine } from "./statusLine";

/**
 * The model picker of the terminal reader (ticket #266, ADR 0052): the reader
 * chooses one of the models the answering agent announces, the choice is a
 * request the agent confirms, and the confirmed Effective Model is what the
 * view model displays. The responder is faked at the module boundary — no
 * ACP agent process, no PTY — and every assertion reads the view model.
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

/**
 * A responder that announces a model selector and applies a request, like
 * the ACP responder over an open session: `adopt` false keeps the agent's own
 * value, which is what a refusal looks like on the wire (ADR 0048).
 */
class ScriptedModelResponder implements ConversationResponder {
  selector: AcpModelSelector | undefined = {
    optionId: "model",
    value: "smart",
    values: [
      { value: "fast", name: "Fast" },
      { value: "balanced", name: "Balanced" },
      { value: "smart", name: "Smart" }
    ]
  };
  agent: StepChatAgentIdentity = { agent: "Copilot", model: "smart", effective: true };
  /** Every value the reader requested, in order. */
  readonly requested: string[] = [];
  adopt = true;
  /** An answer the test keeps in flight, so the streaming state is observable. */
  hold: Promise<string> | undefined;

  identity(): StepChatAgentIdentity {
    return this.agent;
  }

  model(): AcpModelSelector | undefined {
    return this.selector;
  }

  selectModel(value: string): void {
    this.requested.push(value);
    if (!this.adopt) return;
    if (!this.selector?.values.some(option => option.value === value)) return;
    this.selector = { ...this.selector, value };
    this.agent = { ...this.agent, model: value };
  }

  answer(): Promise<string> | string {
    return this.hold ?? "Fake answer";
  }
}

function harness(responder?: ConversationResponder): TourReader {
  return createReader({
    tour,
    root: "/repo",
    speech: new NarrationController({ engine: new MuteSpeechEngine() }),
    // No Git command and no file read in this suite: a plain "none" context
    // and an immediate description render.
    descriptionRenderer: async () => "<p>rendered</p>",
    resolveStepContext: () => ({ kind: "none" }),
    responder
  });
}

async function flushed(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve));
}

test("the reader opens the model picker on `m` with the models the agent announces", async () => {
  const responder = new ScriptedModelResponder();
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  const picker = reader.getState().picker;
  assert.ok(picker, "the picker is open");
  assert.equal(picker.title, "model");
  // The agent's own labels and order, the confirmed model marked as current.
  assert.deepEqual(picker.items, [
    { label: "Fast", current: false },
    { label: "Balanced", current: false },
    { label: "Smart", current: true }
  ]);
  // The highlighted row is the model the agent confirms right now.
  assert.equal(picker.selected, 2);
  assert.equal(picker.notice, undefined);
  assert.equal(picker.hint, " enter choose · esc cancel");
  await reader.close();
});

test("choosing a model applies it to the session and displays the confirmed Effective Model", async () => {
  const responder = new ScriptedModelResponder();
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  // Two rows up from the confirmed Smart: Fast.
  reader.pressKey({ key: "ArrowUp" });
  reader.pressKey({ key: "k" });
  assert.equal(reader.getState().picker?.selected, 0);
  reader.pressKey({ key: "Enter" });
  await flushed();
  // The request reached the agent, the picker closed on it.
  assert.deepEqual(responder.requested, ["fast"]);
  assert.equal(reader.getState().picker, undefined, "the picker closes on the choice");
  // Only the agent's confirmation is displayed: the effective model follows.
  assert.deepEqual(reader.getState().conversation.agent,
    { agent: "Copilot", model: "fast", effective: true });
  assert.ok(reader.getState().status.rightSegments.includes("copilot · fast (effective)"),
    "the status line names the confirmed model: " +
    JSON.stringify(reader.getState().status.rightSegments));
  await reader.close();
});

test("a model the agent refuses becomes a visible error and its own value stays displayed", async () => {
  const responder = new ScriptedModelResponder();
  responder.adopt = false;
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  reader.pressKey({ key: "ArrowUp" });
  reader.pressKey({ key: "Enter" });
  await flushed();
  // The request reached the agent, which kept its own model.
  assert.deepEqual(responder.requested, ["balanced"]);
  assert.equal(reader.getState().conversation.agent?.model, "smart",
    "the agent's own model is what the reader displays");
  assert.ok(reader.getState().status.rightSegments.includes("model: Balanced refused"),
    "the refusal is visible: " + JSON.stringify(reader.getState().status.rightSegments));

  // A choice the agent does adopt clears the stale warning.
  responder.adopt = true;
  reader.pressKey({ key: "m" });
  reader.pressKey({ key: "Enter" });
  await flushed();
  assert.ok(!reader.getState().status.rightSegments.some(segment => segment.startsWith("model: ")),
    "a confirmed choice clears the warning: " +
    JSON.stringify(reader.getState().status.rightSegments));
  await reader.close();
});

test("a model the agent changes by itself is reflected in the profile and in the picker", async () => {
  const responder = new ScriptedModelResponder();
  const reader = harness(responder);
  await reader.open();
  // The agent reports another model (config_option_update, ADR 0048): the
  // reader displays what the agent confirms, never its own last request.
  responder.selector = { optionId: "model", value: "balanced", values: responder.selector!.values };
  responder.agent = { agent: "Copilot", model: "balanced", effective: true };
  assert.deepEqual(reader.getState().conversation.agent,
    { agent: "Copilot", model: "balanced", effective: true });
  reader.pressKey({ key: "m" });
  const picker = reader.getState().picker;
  assert.ok(picker);
  assert.equal(picker.selected, 1, "the picker opens on the model the agent now confirms");
  assert.deepEqual(picker.items.map(item => item.current), [false, true, false]);
  await reader.close();
});

test("an agent that announces no model stays usable with an explicit indication", async () => {
  const responder = new ScriptedModelResponder();
  responder.selector = undefined;
  responder.agent = { agent: "Copilot", effective: true };
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  const picker = reader.getState().picker;
  assert.ok(picker, "the picker still opens: the reader learns why there is nothing to choose");
  assert.deepEqual(picker.items, []);
  assert.equal(picker.selected, -1);
  assert.equal(picker.notice, "agent-managed model");
  assert.equal(picker.hint, " esc close");
  // Accepting an empty list requests nothing and closes the overlay.
  reader.pressKey({ key: "Enter" });
  assert.deepEqual(responder.requested, []);
  assert.equal(reader.getState().picker, undefined);
  // The conversation keeps working: nothing about it needed a model choice.
  reader.pressKey({ key: "a" });
  assert.equal(reader.getState().composer.mode, "asking");
  await reader.close();
});

test("before the session handshake the picker says the agent has not announced its models yet", async () => {
  const responder = new ScriptedModelResponder();
  responder.selector = undefined;
  responder.agent = { agent: "Copilot", effective: false };
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  const picker = reader.getState().picker;
  assert.ok(picker);
  assert.equal(picker.notice, "the agent has not announced its models yet");
  await reader.close();
});

test("the open picker owns the keyboard: no reading key fires underneath it", async () => {
  const responder = new ScriptedModelResponder();
  const reader = harness(responder);
  await reader.open();
  reader.pressKey({ key: "m" });
  // The navigation keys the reading mode would act on never reach it.
  assert.ok(reader.wouldConsume({ key: "ArrowRight" }), "the picker consumes the key");
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  const held = reader.getState();
  assert.equal(held.currentStep, 0, "the reading position did not move");
  assert.equal(held.picker?.selected, 2, "and neither did the highlighted row");
  // A modified key is never the picker's: the terminal still sees Ctrl+C.
  assert.ok(!reader.wouldConsume({ key: "c", ctrl: true }));
  // `q` closes the overlay instead of quitting the reader.
  reader.pressKey({ key: "q" });
  assert.equal(reader.getState().picker, undefined);
  assert.equal(reader.getState().finished, false, "the reader is still reading");
  // Escape cancels without a model request, and `m` closes what it opened.
  reader.pressKey({ key: "m" });
  reader.pressKey({ key: "Escape" });
  assert.equal(reader.getState().picker, undefined);
  reader.pressKey({ key: "m" });
  reader.pressKey({ key: "m" });
  assert.equal(reader.getState().picker, undefined);
  assert.deepEqual(responder.requested, [], "leaving the picker requests no model");
  await reader.close();
});

test("`m` stays terminal-owned without a model selector and is not taken in ask mode", async () => {
  // No responder at all: the key belongs to the terminal.
  const bare = harness();
  assert.ok(!bare.wouldConsume({ key: "m" }));
  await bare.close();

  const responder = new ScriptedModelResponder();
  const reader = harness(responder);
  await reader.open();
  // An `m` typed in the ask prompt stays draft text.
  reader.pressKey({ key: "a" });
  reader.pressKey({ key: "m" });
  assert.equal(reader.getState().picker, undefined);
  assert.ok(reader.getState().composer.draft.includes("m"));
  await reader.close();
});

test("`m` is not taken while an answer streams, so no exchange mixes two models", async () => {
  const responder = new ScriptedModelResponder();
  let release: (() => void) | undefined;
  responder.hold = new Promise<string>(resolve => {
    release = () => resolve("Late answer");
  });
  const reader = harness(responder);
  await reader.open();
  const answered = reader.ask("why?");
  assert.equal(reader.getState().conversation.responding, true);
  assert.ok(!reader.wouldConsume({ key: "m" }), "the key stays terminal-owned while answering");
  release?.();
  await answered;
  assert.equal(reader.getState().conversation.responding, false);
  assert.ok(reader.wouldConsume({ key: "m" }), "the picker is available once the answer settled");
  await reader.close();
});

test("the status line offers the `m` key only when the responder can change the model", async () => {
  const reader = harness(new ScriptedModelResponder());
  await reader.open();
  assert.equal(reader.getState().status.hints,
    " ←/→ step · j/k scroll · a ask · m model · q quit");
  await reader.close();
  const without: ConversationResponder = {
    identity: () => ({ agent: "Fake", effective: true }),
    answer: () => "Fake answer"
  };
  const bare = harness(without);
  await bare.open();
  assert.equal(bare.getState().status.hints,
    " ←/→ step · j/k scroll · a ask · q quit",
    "a responder without model selection never advertises the key");
  await bare.close();
});

test("the model warning sits after the Agent Profile and before the exchange count (spec #240)", () => {
  const status = statusLine({
    conversation: { asking: false, responding: false, hasResponder: true },
    compactHints: false,
    narrationEnabled: true,
    speechWarning: "voice: slow",
    canOpenInVsCode: true,
    canSelectModel: true,
    openWarning: "vscode: boom",
    modelWarning: "model: Balanced refused",
    agent: { agent: "Fake", effective: true },
    exchangeCount: 2
  });
  assert.deepEqual(status.rightSegments, [
    "VOICE ON", "voice: slow", "fake (effective)", "model: Balanced refused",
    "2 exchanges", "vscode: boom"
  ]);
  // While an answer streams the hint yields with the ask hint: no model change
  // is offered mid-exchange.
  const waiting = statusLine({
    conversation: { asking: false, responding: true, hasResponder: true },
    compactHints: true,
    narrationEnabled: false,
    speechWarning: undefined,
    canOpenInVsCode: false,
    canSelectModel: true,
    openWarning: undefined,
    modelWarning: undefined,
    agent: undefined,
    exchangeCount: 0
  });
  assert.equal(waiting.hints, " ←/→ step · j/k scroll · q stop");
});
