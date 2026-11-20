import * as assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CodeTour } from "../../store";
import { loadTour } from "../../store/tourSchema";
import type { AcpModelSelector } from "../../agent/acpModelOptions";
import type { StepChatAgentIdentity, StepChatRequest } from "../../agent/stepChatContract";
import { NarrationController } from "../narration/NarrationController";
import type { NarrationEngine } from "../narration/SystemSpeech";
import type { ConversationResponder } from "./collaborators";
import { composeTerminalReader } from "../terminal";
import type { TourReader, } from "./reader";

/**
 * The end-to-end proof of ticket #241: the composition the CLI entry point
 * performs — the TTY-validated reader over its injected collaborators — plays
 * a real, existing Tour end to end on the view-model seam. No PTY, no VT
 * decoding, no window: everything is asserted at the reading interface, with
 * the narration engine and the conversation responder faked at the module
 * boundary and every other collaborator real (content, Step context, diff).
 */

/**
 * The project root the Tour demo files live in: the real repository checkout,
 * so code references and Mermaid fences resolve against real files.
 */
const projectRoot = path.resolve(__dirname, "../../../..");

/**
 * Wait until the versioned render for `step` commits: the real description
 * renderer and diagram drawing are asynchronous and machine-paced, the
 * commit point (displayedStep) is not.
 */
async function settled(reader: TourReader, step: number): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const state = reader.getState();
    if (!state.rendering && state.displayedStep === step) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("the render for step " + step + " never committed");
}

/**
 * A scripted speech engine: the test settles each utterance itself, so the
 * narration policy (cut at the keypress, committed only for the displayed
 * Step) is observable without timing tricks.
 */
class ScriptedSpeechEngine implements NarrationEngine {
  readonly spoken: string[] = [];
  cancellations = 0;
  disposed = false;
  private readonly settling: Array<(error?: Error) => void> = [];

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise<void>((resolve, reject) => {
      this.settling.push((error?: Error) => {
        error ? reject(error) : resolve();
      });
    });
  }

  cancel(): void {
    this.cancellations++;
  }

  dispose(): void {
    this.disposed = true;
  }

  settle(index: number, error?: Error): void {
    assert.ok(this.settling[index], "no utterance " + index + " to settle");
    this.settling[index](error);
  }
}

/**
 * A scripted conversation responder: it records the grounding request it
 * receives — the same shape the real ACP session layer receives — so the test
 * proves what leaves the reader (per-Step grounding, never a whole-Tour
 * summary) without starting any agent process.
 */
class ScriptedResponder implements ConversationResponder {
  agent: StepChatAgentIdentity = { agent: "Fake Agent", effective: true };
  readonly requests: StepChatRequest[] = [];
  readonly answers: string[] = [];
  disposed = false;
  /** The model values the agent announces, and the one it confirms (ADR 0048). */
  selector: AcpModelSelector | undefined = {
    optionId: "model",
    value: "gpt-5",
    values: [
      { value: "gpt-5", name: "GPT-5" },
      { value: "gpt-6-luna", name: "GPT-6 Luna" }
    ]
  };
  /** Every model value the reader requested, in order. */
  readonly models: string[] = [];

  identity(): StepChatAgentIdentity {
    return this.agent;
  }

  model(): AcpModelSelector | undefined {
    return this.selector;
  }

  selectModel(value: string): void {
    this.models.push(value);
    this.selector = this.selector ? { ...this.selector, value } : undefined;
    this.agent = { ...this.agent, model: value };
  }

  answer(request: StepChatRequest): Promise<string> {
    this.requests.push(request);
    const answer = "Seen " + (request.context.available
      ? (request.context.path ?? "?") : "nothing");
    this.answers.push(answer);
    return Promise.resolve(answer);
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface Composition {
  reader: TourReader;
  speech: ScriptedSpeechEngine;
  responder: ScriptedResponder;
  /** One entry per view-model commit the adapter had to paint. */
  repaints: ReaderViewModelClone[];
}

type ReaderViewModelClone = ReturnType<TourReader["getState"]>;

/**
 * Compose the reader exactly as the CLI entry point composes it, with the
 * engine and the responder faked at the module boundary. Every other
 * collaborator is real: the terminal content module, the Step context
 * resolver and the commit file reader.
 */
function compose(tour: CodeTour, root: string, columns = 120, rows = 40): Composition {
  const speech = new ScriptedSpeechEngine();
  const responder = new ScriptedResponder();
  const repaints: ReaderViewModelClone[] = [];
  const reader = composeTerminalReader({
    tour,
    root,
    columns,
    rows,
    collaborators: {
      speech: new NarrationController({ engine: speech }),
      responder
    },
    onViewChange: () => repaints.push(reader.getState())
  });
  return { reader, speech, responder, repaints };
}

test("the composed CLI reader plays a Tour of this repository end to end on the view-model seam", async () => {
  // The workspace's own demo Tour: an existing .tour file with Mermaid in its
  // explanatory Markdown and file+pattern code anchors.
  const tour = loadTour(
    readFileSync(path.join(projectRoot, ".tours", "lecture-navigation-2026.tour"), "utf8"),
    "test://demo-tour"
  );
  assert.ok(tour.steps.length > 3, "the demo Tour carries several Steps");
  const { reader, speech, responder, repaints } = compose(tour, projectRoot);
  try {
    // Opening settles the first render: the reader is on Step 1 (spec #93).
    await reader.open();
    const first = reader.getState();
    assert.equal(first.tourTitle, "Lecture et navigation des Tours");
    assert.deepEqual(first.stepCount, { index: 0, count: tour.steps.length });
    assert.equal(first.displayedStep, 0);
    assert.equal(first.rendering, false);
    // The Mermaid fence inside the explanatory Markdown reaches the view
    // model as terminal content the adapter paints: termaid draws it (ADR
    // 0024) or the Mermaid source survives verbatim (ticket #241).
    assert.ok(
      /language-(diagram|mermaid-source)/.test(first.descriptionHtml) &&
      first.descriptionHtml.includes("Stockage"),
      "the Mermaid diagram travels with the Step's description\n" + first.descriptionHtml
    );
    const paintsAtLeastOnce = repaints.length >= 1;
    assert.ok(paintsAtLeastOnce, "the adapter is notified of the committed render");

    // Walk every Step: anchors, titles, descriptions and code references.
    for (let index = 1; index < tour.steps.length; index++) {
      const target = reader.navigateTo(index);
      assert.equal(target.currentStep, index, "the navigation target moves at the keypress");
      await settled(reader, index);
      const state = reader.getState();
      assert.equal(state.displayedStep, index);
      assert.equal(state.stepCount.index, index, "the counter follows the displayed Step");
      assert.ok(state.stepTitle, "each Step carries a title or its fallback");
      assert.ok(state.descriptionHtml, "each Step carries its explanation");
      const anchoredStep = tour.steps[index];
      if (anchoredStep.file) {
        assert.ok(state.anchor.target.startsWith(anchoredStep.file),
          "the anchor names the Step's file: " + state.anchor.target);
        assert.equal(state.source?.kind, "code");
        assert.ok(state.source.lines.length > 0, "the code reference carries its source lines");
      }
    }

    // The boundary clamps: no Step beyond the Tour's end.
    const afterEnd = reader.navigateTo(tour.steps.length);
    assert.equal(afterEnd.currentStep, tour.steps.length - 1);

    // Step Narration: the voice starts off, one unmodified-v-equivalent
    // toggle turns it on, the displayed Step is spoken, a navigation cuts
    // that speech at the keypress and commits the next Step once its render
    // lands, and the second toggle cuts the speech and stops the voice.
    reader.navigateTo(0);
    await settled(reader, 0);
    assert.equal(reader.getState().narration.enabled, false);
    assert.equal(speech.spoken.length, 0, "the voice is off by default (ADR 0029)");
    reader.toggleVoice();
    assert.equal(reader.getState().narration.enabled, true);
    assert.equal(speech.spoken.length, 1, "the displayed Step's description is narrated");
    assert.ok(speech.spoken[0].length > 0);
    reader.navigateTo(1);
    assert.ok(speech.cancellations >= 1, "a navigation cuts the previous speech at the keypress");
    await settled(reader, 1);
    assert.ok(speech.spoken.length === 2, "the narration commits for the Step that is now displayed");
    reader.toggleVoice();
    assert.equal(reader.getState().narration.enabled, false);
    assert.ok(speech.cancellations >= 2, "turning the voice off cuts the current speech");

    // The Tour Step Conversation: the responder receives the grounding of the
    // displayed Step only — its description and its code — never a whole-Tour
    // summary, and the settled exchange is in the view model.
    const displayed = reader.getState().displayedStep;
    await reader.ask("What does this Step anchor to?");
    const request = responder.requests.at(-1);
    assert.ok(request, "the reader asks the responder");
    assert.equal(request.question, "What does this Step anchor to?");
    assert.equal(request.workspaceRoot, projectRoot);
    assert.ok(request.context.available, "the Step grounding is available");
    assert.equal(request.context.description,
      tour.steps[displayed].description,
      "the grounding is the displayed Step's own explanation");
    const answered = reader.getState();
    const exchange = answered.conversation.exchanges[0];
    assert.equal(exchange.pending, false);
    assert.equal(exchange.answer, responder.answers[0]);
    assert.ok(answered.conversation.hasResponder);
    assert.ok(answered.status.rightSegments.some(segment =>
      segment.toLowerCase().includes("fake agent")),
      "the status line names the Agent Profile: " + answered.status.rightSegments.join(" · "));

    // Asking for a whole-Tour summary in the conversation does not change
    // what the conversation is fed (ticket #241): the grounding stays the
    // displayed Step's own — a Tour summary is not a reading path.
    await reader.ask("Summarize the whole Tour in text instead of reading it.");
    const summaryRequest = responder.requests.at(-1);
    assert.ok(summaryRequest, "the summary request reaches the responder seam");
    assert.equal(summaryRequest.workspaceRoot, projectRoot);
    assert.equal(summaryRequest.context.description,
      tour.steps[reader.getState().displayedStep].description,
      "even a summary demand is grounded in the displayed Step, never the whole Tour");
    assert.equal(responder.requests.length, 2);
  } finally {
    await reader.close();
    // The session is over: the view model reports it and the collaborators
    // are released — the engine seam and the responder alike.
    assert.equal(reader.getState().finished, true);
    assert.equal(speech.disposed, true);
    assert.equal(responder.disposed, true);
  }
});

test("the composed CLI reader carries a diff Step's real diff onto the view model", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-t2-diff-"));
  try {
    mkdirSync(path.join(root, ".tours"));
    writeFileSync(path.join(root, "code.ts"), "export const before = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "code.ts"], { cwd: root });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid",
      "commit", "-qm", "base"], { cwd: root });
    const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    writeFileSync(path.join(root, "code.ts"), "export const after = 2;\n");
    execFileSync("git", ["add", "code.ts"], { cwd: root });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid",
      "commit", "-qm", "head"], { cwd: root });
    const ref = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const tour = loadTour(JSON.stringify({
      title: "Changes Walkthrough",
      baseRef,
      ref,
      steps: [{
        title: "The change",
        file: "code.ts",
        line: 1,
        display: "diff",
        description: "Walks the diff between the two commits."
      }, {
        title: "The picture",
        description: "![Example](./image.png) shows what changed."
      }]
    }), "test://diff-tour");

    const { reader } = compose(tour, root, 100, 30);
    try {
      await reader.open();
      const state = reader.getState();
      assert.equal(state.displayedStep, 0);
      assert.equal(state.anchor.diff, true, "the adapter paints the ' · diff' suffix");
      assert.ok(state.anchor.target.startsWith("code.ts"));
      assert.equal(state.source?.kind, "diff");
      const diff = state.source?.lines.join("\n") ?? "";
      assert.match(diff, /@@/, "the diff carries its hunk header");
      assert.ok(diff.split("\n").some(line => line.startsWith("+") && line.includes("after")),
        "the added line of the real diff reaches the view model");

      // Images travel too: the Step's referenced picture reaches the view
      // model as the content the adapter paints (terminal half-block, ADR
      // 0024) — nothing of the explanation is lost on the seam.
      writeFileSync(path.join(root, "image.png"), Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6T8AAAAASUVORK5CYII=",
        "base64"));
      reader.navigateTo(1);
      await settled(reader, 1);
      const imageStep = reader.getState();
      assert.equal(imageStep.displayedStep, 1);
      assert.ok(imageStep.descriptionHtml.includes("data:image/png;base64,"),
        "the Step's image reaches the view model\n" + imageStep.descriptionHtml);
    } finally {
      await reader.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the composed CLI reader chooses a model among those the agent announces (ticket #266)", async () => {
  const tour = loadTour(JSON.stringify({
    title: "Model tour",
    steps: [{ file: "src/cli/reader/reader.ts", line: 1, description: "Anchored Step" }]
  }), "test://model-tour");
  const { reader, responder } = compose(tour, projectRoot, 100, 30);
  try {
    await reader.open();
    // The picker lists exactly what the agent announced, the confirmed model
    // marked current — no catalogue of CodeTour's own.
    reader.pressKey({ key: "m" });
    const picker = reader.getState().picker;
    assert.ok(picker, "the picker opens on the composed reader too");
    assert.deepEqual(picker.items, [
      { label: "GPT-5", current: true },
      { label: "GPT-6 Luna", current: false }
    ]);
    reader.pressKey({ key: "ArrowDown" });
    reader.pressKey({ key: "Enter" });
    // The request reached the responder, and the confirmed model is displayed.
    assert.deepEqual(responder.models, ["gpt-6-luna"]);
    const state = reader.getState();
    assert.equal(state.picker, undefined);
    assert.deepEqual(state.conversation.agent,
      { agent: "Fake Agent", model: "gpt-6-luna", effective: true });
    assert.ok(state.status.rightSegments.includes("fake agent · gpt-6-luna (effective)"),
      "the status line names the confirmed model: " + JSON.stringify(state.status.rightSegments));
    assert.ok(state.status.hints.includes("m model"),
      "the composed reader advertises the key: " + state.status.hints);
  } finally {
    await reader.close();
  }
});
