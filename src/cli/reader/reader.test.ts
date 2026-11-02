import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeTour, CodeTourStep } from "../../store";
import type { StepChatAnswerEvents, StepChatRequest } from "../../agent/stepChatContract";
import type { ConversationResponder, DescriptionRenderer, SpeechEngine, StepContextResolver } from "./collaborators";
import { createReader, type TourReader } from "./reader";

/**
 * The reading interface of the terminal Tour reader (spec #93). Every test
 * drives the interface in-process and asserts on the view model only: no
 * PTY, no VT bytes, no DOM — the collaborators (speech engine, conversation
 * responder, description renderer, Step context resolver) are fakes at the
 * module boundary, the same determinism the NarrationController tests
 * achieve with a fake engine.
 */

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function tourWith(steps: CodeTourStep[]): CodeTour {
  return { id: "reader-test", title: "Reader", steps };
}

/**
 * A scripted speech engine: the test decides when each utterance settles.
 * Nothing in these tests relies on audible output or a speech subprocess.
 */
class FakeSpeechEngine implements SpeechEngine {
  readonly spoken: string[] = [];
  cancellations = 0;
  disposed = false;

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }

  cancel(): void {
    this.cancellations++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

/**
 * A description renderer the test controls: each Step's render stays pending
 * until the test resolves or fails it, so render supersession under rapid
 * navigation is deterministic without timing tricks.
 */
class FakeDescriptionRenderer {
  /** One pending render per started request, in start order. */
  private readonly pending: Array<{
    index: number;
    resolve: (html: string) => void;
    reject: (error: unknown) => void;
  }> = [];
  readonly requested: Array<{ index: number; width: number }> = [];

  readonly render: DescriptionRenderer = (_tour, index, width) => {
    this.requested.push({ index, width });
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ index, resolve, reject });
    });
  };

  private oldest(index: number) {
    return this.pending.find(entry => entry.index === index);
  }

  /** Commit the oldest pending render of one Step. */
  commit(index: number, html: string): void {
    const entry = this.oldest(index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.resolve(html);
  }

  /** Fail the oldest pending render of one Step. */
  fail(index: number, error: unknown): void {
    const entry = this.oldest(index);
    assert.ok(entry, "no pending render for step " + index);
    this.pending.splice(this.pending.indexOf(entry), 1);
    entry.reject(error);
  }
}

/** A conversation responder the test scripts; no ACP agent process is started. */
class FakeResponder implements ConversationResponder {
  readonly providerName = "Fake";
  readonly requests: StepChatRequest[] = [];
  disposed = false;
  /** The answer the next question resolves with; the test can override it. */
  nextAnswer: (request: StepChatRequest, events?: StepChatAnswerEvents) => Promise<string> =
    async () => "Fake answer";

  answer(request: StepChatRequest, events?: StepChatAnswerEvents): Promise<string> {
    this.requests.push(request);
    return this.nextAnswer(request, events);
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface Harness {
  reader: TourReader;
  speech: FakeSpeechEngine;
  descriptions: FakeDescriptionRenderer;
  responder: FakeResponder | undefined;
}

/**
 * A reader wired entirely to fakes: the Step context resolver returns a
 * plain "none" context unless a test overrides it, so no Git command and no
 * file read ever runs in this suite.
 */
function harness(
  steps: CodeTourStep[],
  options: { responder?: FakeResponder; context?: StepContextResolver; columns?: number; rows?: number } = {}
): Harness {
  const speech = new FakeSpeechEngine();
  const descriptions = new FakeDescriptionRenderer();
  const reader = createReader({
    tour: tourWith(steps),
    root: "/workspace",
    speechEngine: speech,
    descriptionRenderer: descriptions.render,
    resolveStepContext: options.context ?? (() => ({ kind: "none" })),
    responder: options.responder,
    columns: options.columns,
    rows: options.rows
  });
  return { reader, speech, descriptions, responder: options.responder };
}

test("an empty Tour opens on the no-steps message and stays interactive", async () => {
  const { reader } = harness([]);
  await reader.open();
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.displayedStep, -1);
  assert.equal(state.rendering, false);
  assert.equal(state.finished, false);
  assert.equal(state.tourTitle, "Reader");
  assert.equal(state.stepCount, "step 0/0");
  assert.equal(state.emptyMessage, "Tour has no steps. Press q to quit.");
  assert.equal(state.stepTitle, "");
  assert.equal(state.descriptionHtml, "");
  assert.deepEqual(state.rail.items, []);
});

test("the empty Tour conversation panel reports the no-agent state for step 0", async () => {
  const { reader } = harness([]);
  await reader.open();
  const state = reader.getState();
  assert.equal(state.conversation.title, "conversation");
  assert.equal(state.conversation.meta, "no agent");
  assert.equal(state.conversation.hasResponder, false);
  assert.deepEqual(state.conversation.suggestions, []);
  assert.deepEqual(state.conversation.exchanges, []);
  assert.equal(state.conversation.responding, false);
  assert.equal(state.composer.mode, "unavailable");
  assert.equal(state.composer.prompt, "no ACP agent");
  assert.equal(state.composer.hint, "no agent on PATH");
});

test("opening a Tour renders the first Step and commits the painted reading state", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello", file: "src/a.ts", line: 12 },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  // The description render is in flight: the target is set, nothing is displayed yet.
  assert.equal(reader.getState().currentStep, 0);
  assert.equal(reader.getState().displayedStep, -1);
  assert.equal(reader.getState().rendering, true);
  // The description renders at the layout's text width (80 columns → 38 cells).
  assert.deepEqual(descriptions.requested, [{ index: 0, width: 38 }]);
  descriptions.commit(0, "<p>rendered first</p>");
  await opening;
  const state = reader.getState();
  assert.equal(state.displayedStep, 0);
  assert.equal(state.rendering, false);
  assert.equal(state.tourTitle, "Reader");
  assert.equal(state.stepCount, "step 1/2");
  assert.equal(state.stepTitle, "First");
  assert.equal(state.descriptionHtml, "<p>rendered first</p>");
  assert.equal(state.anchorText, "src/a.ts:12");
  assert.equal(state.emptyMessage, undefined);
});

test("a Step without a title falls back to its number and its anchor keeps the diff suffix", async () => {
  const { reader, descriptions } = harness(
    [{ description: "Hello", uri: "https://example.test/doc" }],
    { context: () => ({ kind: "diff", label: "src/a.ts (base ↔ head)", text: "+added" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const state = reader.getState();
  assert.equal(state.stepTitle, "Step 1");
  // The anchor keeps its path whole; the diff suffix is the reader's to add.
  assert.equal(state.anchorText, "https://example.test/doc · diff");
});

test("a code Step context becomes the source section with its label stripped", async () => {
  const { reader, descriptions } = harness([{ description: "Hello", file: "src/a.ts" }], {
    context: () => ({ kind: "code", label: "src/a.ts (irrelevant)", text: "one\ntwo" })
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const source = reader.getState().source;
  assert.ok(source);
  assert.equal(source.kind, "code");
  assert.equal(source.label, "src/a.ts");
  assert.equal(source.tag, "code");
  assert.deepEqual(source.lines, ["one", "two"]);
});

test("an unreadable Step target becomes an n/a source section with its diagnostic", async () => {
  const { reader, descriptions } = harness([{ description: "Hello", file: "gone.ts" }], {
    context: () => ({ kind: "unavailable", label: "gone.ts", diagnostic: "File unavailable: gone" })
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  const source = reader.getState().source;
  assert.ok(source);
  assert.equal(source.kind, "unavailable");
  assert.equal(source.label, "gone.ts");
  assert.equal(source.tag, "n/a");
  assert.deepEqual(source.lines, ["File unavailable: gone"]);
});

test("a Step without a target context paints no source section", async () => {
  const { reader, descriptions } = harness([{ description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>rendered</p>");
  await opening;
  assert.equal(reader.getState().source, undefined);
});

test("navigation moves the target at the keypress and displays it when the render commits", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  const state = reader.navigateTo(1);
  // The target moves immediately; the display still shows the previous Step.
  assert.equal(state.currentStep, 1);
  assert.equal(state.displayedStep, 0);
  assert.equal(state.rendering, true);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  const committed = reader.getState();
  assert.equal(committed.displayedStep, 1);
  assert.equal(committed.currentStep, 1);
  assert.equal(committed.stepCount, "step 2/2");
  assert.equal(committed.stepTitle, "Second");
  assert.equal(committed.rendering, false);

  reader.pressKey({ key: "ArrowLeft" });
  descriptions.commit(0, "<p>first again</p>");
  await flush();
  assert.equal(reader.getState().displayedStep, 0);
  assert.equal(reader.getState().stepTitle, "First");
});

test("navigation keys honor the first and last Step boundaries", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  // Before the first Step, left does nothing.
  reader.pressKey({ key: "ArrowLeft" });
  reader.pressKey({ key: "p" });
  assert.equal(reader.getState().currentStep, 0);

  reader.pressKey({ key: "n" });
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.equal(reader.getState().currentStep, 1);

  // At the last Step, right does nothing.
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  assert.equal(reader.getState().currentStep, 1);
  assert.equal(reader.getState().rendering, false);

  // An unrelated key changes nothing.
  reader.pressKey({ key: "x" });
  assert.equal(reader.getState().currentStep, 1);
  assert.equal(reader.getState().displayedStep, 1);
});

test("navigateTo ignores steps outside the Tour", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.navigateTo(5);
  reader.navigateTo(-1);
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.rendering, false);
});

test("the rail window keeps the displayed Step visible with its markers", async () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({ title: "Step " + index, description: "d" }));
  const { reader, descriptions } = harness(steps, { columns: 120, rows: 10 });
  const opening = reader.open();
  // A resize-free harness: navigate to the middle Step and commit it.
  descriptions.commit(0, "<p>0</p>");
  await opening;
  reader.navigateTo(5);
  descriptions.commit(5, "<p>5</p>");
  await flush();
  const state = reader.getState();
  assert.equal(state.railVisible, true);
  // 10 rows minus 6 chrome rows = a 4-row rail: 2 items plus the two markers.
  assert.deepEqual(state.rail.items.map(item => item.index), [4, 5]);
  assert.equal(state.rail.items[1].active, true);
  assert.equal(state.rail.items[1].title, "Step 5");
  assert.equal(state.rail.before, true);
  assert.equal(state.rail.after, true);
});

test("the rail stays hidden below the width where it stops paying for itself", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], { columns: 80 });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  assert.equal(reader.getState().railVisible, false);
});

test("a superseded render changes nothing while a newer navigation is in flight", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" },
    { title: "Third", description: "!" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  // Two rapid navigations while the description renders are still pending.
  reader.navigateTo(1);
  reader.navigateTo(2);
  assert.equal(reader.getState().currentStep, 2);

  // The first render settles: superseded, it paints nothing.
  descriptions.commit(1, "<p>second</p>");
  await flush();
  const superseded = reader.getState();
  assert.equal(superseded.displayedStep, 0);
  assert.equal(superseded.stepTitle, "First");
  assert.equal(superseded.descriptionHtml, "<p>first</p>");
  assert.equal(superseded.rendering, true);

  descriptions.commit(2, "<p>third</p>");
  await flush();
  const committed = reader.getState();
  assert.equal(committed.displayedStep, 2);
  assert.equal(committed.stepTitle, "Third");
  assert.equal(committed.rendering, false);
});

test("rapid key navigation superscedes in-flight renders the same way", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" },
    { title: "Third", description: "!" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  assert.equal(reader.getState().currentStep, 2);
  descriptions.commit(1, "<p>second</p>");
  descriptions.commit(2, "<p>third</p>");
  await flush();
  const state = reader.getState();
  assert.equal(state.displayedStep, 2);
  assert.equal(state.stepTitle, "Third");
});

test("a failed Step render keeps the previous screen state and reports the diagnostic", async () => {
  const { reader, descriptions, speech } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;

  reader.navigateTo(1);
  descriptions.fail(1, new Error("render exploded"));
  await flush();
  const state = reader.getState();
  // The previous screen state is restored in the view model: the adapter
  // repaints it after the alternate-screen restore, then prints the
  // diagnostic (ADR 0025).
  assert.equal(state.displayedStep, 0);
  assert.equal(state.stepTitle, "First");
  assert.equal(state.descriptionHtml, "<p>first</p>");
  assert.equal(state.stepCount, "step 1/2");
  assert.equal(state.fatal?.message, "render exploded");
  assert.equal(state.finished, true);
  assert.equal(state.rendering, false);
  assert.equal(speech.disposed, true);

  // The session is over: every further input is ignored.
  reader.pressKey({ key: "ArrowRight" });
  reader.navigateTo(0);
  assert.equal(reader.getState().currentStep, 1);
});

test("a failed initial render reports the diagnostic with nothing displayed", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.fail(0, new Error("no renderer"));
  await opening;
  const state = reader.getState();
  assert.equal(state.displayedStep, -1);
  assert.equal(state.stepTitle, "");
  assert.equal(state.fatal?.message, "no renderer");
  assert.equal(state.finished, true);
});

test("a diff Step without a resolved diff fails the render with the terminal error", async () => {
  const { reader, descriptions } = harness(
    [
      { title: "First", description: "Hello" },
      { description: "Comparison", display: "diff", file: "src/a.ts" }
    ],
    { context: () => ({ kind: "none" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.navigateTo(1);
  descriptions.commit(1, "<p>comparison</p>");
  await flush();
  assert.equal(
    reader.getState().fatal?.message,
    "CodeTour terminal stopped: Tour 'Reader', step 2 ('Untitled'), Git diff: " +
      "persisted base/head snapshot or file comparison unavailable"
  );
});

test("pressing q closes the session and releases the collaborators", async () => {
  const { reader, descriptions, speech, responder } = harness(
    [{ title: "Only", description: "Hello" }],
    { responder: new FakeResponder() }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "q" });
  await flush();
  const state = reader.getState();
  assert.equal(state.finished, true);
  assert.equal(speech.disposed, true);
  assert.ok(responder?.disposed);
});

test("scroll keys move the Step-box offset and clamp against the reported extents", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  // The adapter reports its measured extents: 3 viewport rows of 10 content rows.
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 10 });

  reader.pressKey({ key: "j" });
  reader.pressKey({ key: "ArrowDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
  reader.pressKey({ key: "k" });
  assert.equal(reader.getState().scroll.stepScrollTop, 1);

  // A page is one screenful of the Step box (ADR 0025).
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 4);
  reader.pressKey({ key: "PageUp" });
  assert.equal(reader.getState().scroll.stepScrollTop, 1);
  reader.pressKey({ key: " " });
  assert.equal(reader.getState().scroll.stepScrollTop, 4);

  // Scrolling past either end clamps: the bottom is content - viewport rows.
  for (let i = 0; i < 10; i++) reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 7);
  for (let i = 0; i < 10; i++) reader.pressKey({ key: "PageUp" });
  assert.equal(reader.getState().scroll.stepScrollTop, 0);
});

test("a Step change paints the Step box from the top again", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 3);
  reader.navigateTo(1);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  assert.equal(reader.getState().scroll.stepScrollTop, 0);
});

test("newly reported extents clamp the current offset", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 6);
  // The adapter paints a shorter Step and reports smaller extents.
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 5 });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
});

test("a resize re-renders at the new geometry and restores the clamped scroll offset", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.pressKey({ key: "PageDown" });
  assert.equal(reader.getState().scroll.stepScrollTop, 6);

  reader.resize(120, 24);
  // The re-render is in flight at the new layout's text width (120 columns → 44 cells).
  assert.equal(reader.getState().rendering, true);
  assert.equal(reader.getState().layout.columns, 120);
  assert.equal(descriptions.requested[descriptions.requested.length - 1].width, 44);
  descriptions.commit(0, "<p>only, wider</p>");
  await flush();
  // The adapter paints the new geometry and reports its extents; the saved
  // offset comes back, clamped to the new content height.
  reader.onExtentsMeasured({ stepViewportRows: 4, stepContentRows: 12 });
  const state = reader.getState();
  assert.equal(state.displayedStep, 0);
  assert.equal(state.descriptionHtml, "<p>only, wider</p>");
  assert.equal(state.scroll.stepScrollTop, 6);
  reader.onExtentsMeasured({ stepViewportRows: 10, stepContentRows: 12 });
  assert.equal(reader.getState().scroll.stepScrollTop, 2);
});

test("a resize to the same geometry repaints nothing", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const requests = descriptions.requested.length;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.resize(80, 24);
  const state = reader.getState();
  assert.equal(state.rendering, false);
  assert.equal(descriptions.requested.length, requests);
  assert.equal(state.scroll.stepScrollTop, 3);
});

test("a navigation superseding a resize render wins the scroll policy", async () => {
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ]);
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  reader.onExtentsMeasured({ stepViewportRows: 3, stepContentRows: 30 });
  reader.pressKey({ key: "PageDown" });
  reader.resize(120, 24);
  // Before the resize render commits, the reader navigates: its render is
  // the newer one and paints from the top.
  reader.pressKey({ key: "ArrowRight" });
  descriptions.commit(0, "<p>first, wider</p>");
  descriptions.commit(1, "<p>second</p>");
  await flush();
  reader.onExtentsMeasured({ stepViewportRows: 10, stepContentRows: 30 });
  const state = reader.getState();
  assert.equal(state.displayedStep, 1);
  assert.equal(state.scroll.stepScrollTop, 0);
});

test("the status line reports the reading mode and its key hints", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  // 80 columns: the compact hints.
  assert.equal(reader.getState().status.mode, "READ");
  assert.equal(reader.getState().status.hints, " ←/→ step · j/k scroll · q quit");
});

test("a wide terminal spells the hints out and an agent adds the ask hint", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    columns: 130,
    responder: new FakeResponder()
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const status = reader.getState().status;
  assert.equal(status.mode, "READ");
  assert.equal(status.hints, " ←/→ previous/next · j/k scroll · PgUp/PgDn page · a ask · q quit");
  // The right segments: the voice state first, then the provider.
  assert.deepEqual(status.rightSegments, ["VOICE OFF", "fake"]);
});

test("the voice state leads the right segments and no agent paints only it", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  assert.deepEqual(reader.getState().status.rightSegments, ["VOICE OFF"]);
});

test("a single unmodified v toggles the voice; modified combos pass through", async () => {
  const { reader, descriptions, speech } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "v" });
  let state = reader.getState();
  assert.equal(state.narration.enabled, true);
  assert.deepEqual(state.status.rightSegments, ["VOICE ON"]);

  // Ctrl+V, Cmd+V and Alt+V are not the narration shortcut (spec #79).
  reader.pressKey({ key: "v", ctrl: true });
  reader.pressKey({ key: "V", meta: true });
  reader.pressKey({ key: "v", alt: true });
  assert.equal(reader.getState().narration.enabled, true);

  reader.pressKey({ key: "V" });
  state = reader.getState();
  assert.equal(state.narration.enabled, false);
  // Turning the voice off cuts the current speech (ADR 0029).
  assert.equal(speech.cancellations, 1);
  assert.deepEqual(state.status.rightSegments, ["VOICE OFF"]);
});

test("'a' enters ask mode only with an agent installed and no answer streaming", async () => {
  const bare = harness([{ title: "Only", description: "Hello" }]);
  const bareOpening = bare.reader.open();
  bare.descriptions.commit(0, "<p>only</p>");
  await bareOpening;
  // Without an agent the ask key falls through unhandled.
  bare.reader.pressKey({ key: "a" });
  assert.equal(bare.reader.getState().composer.mode, "unavailable");

  const withAgent = harness([{ title: "Only", description: "Hello" }], {
    responder: new FakeResponder()
  });
  const opening = withAgent.reader.open();
  withAgent.descriptions.commit(0, "<p>only</p>");
  await opening;
  withAgent.reader.pressKey({ key: "a" });
  const state = withAgent.reader.getState();
  assert.equal(state.composer.mode, "asking");
  assert.equal(state.composer.draft, "");
  assert.equal(state.composer.prompt, "▌");
  assert.equal(state.composer.hint, "question for this step");
  assert.equal(state.status.mode, "ASK");
  assert.equal(state.status.hints, " enter send · esc cancel");
});

test("the ask prompt owns the keyboard: every printable key stays draft text", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder: new FakeResponder()
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "a" });
  // A "v" typed in the prompt is text, not the voice toggle; "q" does not
  // quit; a digit is not a suggestion key while asking (spec #79).
  reader.pressKey({ key: "v" });
  reader.pressKey({ key: "q" });
  reader.pressKey({ key: "2" });
  reader.pressKey({ key: "ArrowRight" });
  let state = reader.getState();
  assert.equal(state.composer.draft, "vq2");
  assert.equal(state.composer.prompt, "vq2▌");
  assert.equal(state.narration.enabled, false);
  assert.equal(state.currentStep, 0);
  assert.equal(state.finished, false);

  reader.pressKey({ key: "Backspace" });
  state = reader.getState();
  assert.equal(state.composer.draft, "vq");
  assert.equal(state.status.mode, "ASK");

  // Escape cancels the draft and returns the keyboard to the reader.
  reader.pressKey({ key: "Escape" });
  state = reader.getState();
  assert.equal(state.composer.mode, "idle");
  assert.equal(state.composer.draft, "");
  assert.equal(state.status.mode, "READ");
  assert.equal(state.conversation.exchanges.length, 0);
});

test("Enter submits the trimmed question, exits ask mode and dispatches it", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", file: "src/a.ts" }],
    { responder, context: () => ({ kind: "code", label: "src/a.ts", text: "line" }) }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  reader.pressKey({ key: "a" });
  reader.pressKey({ key: " " });
  reader.pressKey({ key: "w" });
  reader.pressKey({ key: "h" });
  reader.pressKey({ key: "y" });
  reader.pressKey({ key: " " });
  reader.pressKey({ key: "Enter" });

  const state = reader.getState();
  // Ask mode is exited and the answer is already in flight (WAIT mode).
  assert.equal(state.composer.mode, "responding");
  assert.equal(state.composer.draft, "");
  assert.equal(responder.requests.length, 1);
  assert.equal(responder.requests[0].question, "why");
  // The question is grounded in the Step the reader sees (spec #93).
  assert.deepEqual(responder.requests[0].context, {
    available: true,
    path: "src/a.ts",
    code: "line",
    description: "Hello"
  });
  assert.equal(responder.requests[0].workspaceRoot, "/workspace");
  await flush();
  const done = reader.getState();
  assert.equal(done.composer.mode, "idle");
  assert.equal(done.conversation.exchanges.length, 1);
  assert.equal(done.conversation.exchanges[0].answer, "Fake answer");
});

test("suggestion keys ask the matching suggestion when it exists", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness(
    [{ title: "Only", description: "Hello", questions: ["First question", "Second question"] }],
    { responder }
  );
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;

  // The composer hint announces the suggestion keys.
  assert.equal(reader.getState().composer.hint, "a ask · 1-2 suggestion");
  reader.pressKey({ key: "2" });
  assert.equal(responder.requests.length, 1);
  assert.equal(responder.requests[0].question, "Second question");

  // A digit without its suggestion falls through unhandled.
  reader.pressKey({ key: "3" });
  assert.equal(responder.requests.length, 1);
  assert.equal(reader.getState().currentStep, 0);
  await flush();
});

test("a question without an agent fails the exchange with the guidance", async () => {
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }]);
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.exchanges.length, 1);
  assert.deepEqual(state.conversation.exchanges[0], {
    question: "why?",
    answer: "",
    pending: false,
    error: "No ACP agent is installed to answer this question.",
    tools: []
  });
  // The chat head still reports the no-agent state.
  assert.equal(state.conversation.meta, "no agent");
});

test("an answer streams into the exchange, reports tools and completes", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async (_request, events) => {
    events?.onActivity?.("thinking");
    events?.onAnswerDelta?.("Hel");
    events?.onAnswerDelta?.("lo");
    return "Hello";
  };
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.responding, false);
  assert.equal(state.conversation.exchanges.length, 1);
  assert.equal(state.conversation.exchanges[0].pending, false);
  assert.equal(state.conversation.exchanges[0].answer, "Hello");
  assert.deepEqual(state.conversation.exchanges[0].tools, ["thinking"]);
  assert.equal(state.conversation.meta, "1 exchange");
  // The status line gains the exchange count after the voice state and the provider.
  assert.deepEqual(state.status.rightSegments, ["VOICE OFF", "fake", "1 exchange"]);
});

test("a streaming answer paints WAIT mode and hides the ask hint", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("why?");
  await flush();
  const state = reader.getState();
  assert.equal(state.status.mode, "WAIT");
  assert.equal(state.composer.mode, "responding");
  assert.equal(state.composer.prompt, "answering…");
  assert.equal(state.composer.hint, "answer streaming");
  assert.doesNotMatch(state.status.hints, /a ask/);
  assert.equal(state.conversation.responding, true);
  assert.ok(release);
  release!();
  await asking;
  const done = reader.getState();
  assert.equal(done.status.mode, "READ");
  assert.equal(done.composer.mode, "idle");
  assert.equal(done.conversation.responding, false);
});

test("one answer is in flight at a time", async () => {
  let release: (() => void) | undefined;
  const responder = new FakeResponder();
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("done");
  });
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  const asking = reader.ask("first?");
  await flush();
  await reader.ask("second?");
  assert.equal(responder.requests.length, 1);
  // The ask key is blocked while an answer streams.
  reader.pressKey({ key: "a" });
  assert.equal(reader.getState().composer.mode, "responding");
  release!();
  await asking;
  assert.equal(reader.getState().conversation.responding, false);
});

test("a failed answer fails the exchange and unlocks asking again", async () => {
  const responder = new FakeResponder();
  responder.nextAnswer = async () => {
    throw new Error("agent went away");
  };
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  await reader.ask("why?");
  const state = reader.getState();
  assert.equal(state.conversation.exchanges[0].error, "agent went away");
  assert.equal(state.conversation.exchanges[0].pending, false);
  assert.equal(state.conversation.responding, false);
  // A retry is possible: the failed exchange is not history.
  responder.nextAnswer = async () => "Recovered";
  await reader.ask("again?");
  const after = reader.getState();
  assert.equal(after.conversation.exchanges.length, 2);
  assert.equal(after.conversation.exchanges[1].answer, "Recovered");
  assert.equal(responder.requests[1].history.length, 0);
});

test("the empty Tour reports the bare no-steps message when a resize re-renders it", async () => {
  const { reader, descriptions } = harness([]);
  await reader.open();
  assert.equal(reader.getState().emptyMessage, "Tour has no steps. Press q to quit.");
  reader.resize(100, 30);
  // The render's defensive empty path: the article shows the bare message
  // and the topbar keeps its startup "step 0/0" counter.
  const state = reader.getState();
  assert.equal(state.emptyMessage, "This Tour has no steps.");
  assert.equal(state.stepCount, "step 0/0");
  assert.equal(state.displayedStep, -1);
  assert.equal(state.rendering, false);
  assert.equal(descriptions.requested.length, 0);
});

test("the empty Tour ignores Step keys and quits on q", async () => {
  const { reader } = harness([]);
  await reader.open();
  reader.pressKey({ key: "ArrowRight" });
  reader.pressKey({ key: "n" });
  reader.pressKey({ key: "2" });
  reader.pressKey({ key: "a" });
  reader.pressKey({ key: "j" });
  const state = reader.getState();
  assert.equal(state.currentStep, 0);
  assert.equal(state.finished, false);
  assert.equal(state.scroll.stepScrollTop, 0);
  reader.pressKey({ key: "q" });
  await flush();
  assert.equal(reader.getState().finished, true);
});

test("a finished session ignores resize and further questions", async () => {
  const responder = new FakeResponder();
  const { reader, descriptions } = harness([{ title: "Only", description: "Hello" }], {
    responder
  });
  const opening = reader.open();
  descriptions.commit(0, "<p>only</p>");
  await opening;
  reader.pressKey({ key: "q" });
  await flush();
  reader.resize(200, 40);
  await reader.ask("anyone there?");
  const state = reader.getState();
  assert.equal(state.finished, true);
  assert.equal(state.layout.columns, 80);
  assert.equal(responder.requests.length, 0);
});

test("an exchange is recorded under its own Step across navigation", async () => {
  const responder = new FakeResponder();
  let release: (() => void) | undefined;
  responder.nextAnswer = () => new Promise<string>(resolve => {
    release = () => resolve("answer");
  });
  const { reader, descriptions } = harness([
    { title: "First", description: "Hello" },
    { title: "Second", description: "World" }
  ], { responder });
  const opening = reader.open();
  descriptions.commit(0, "<p>first</p>");
  await opening;
  const asking = reader.ask("about the first?");
  await flush();
  // The reader navigates away while the answer streams.
  reader.navigateTo(1);
  descriptions.commit(1, "<p>second</p>");
  await flush();
  release!();
  await asking;
  // The new Step shows its own, empty conversation.
  let state = reader.getState();
  assert.equal(state.currentStep, 1);
  assert.equal(state.conversation.exchanges.length, 0);
  // The exchange stayed with the Step it was asked about.
  reader.navigateTo(0);
  descriptions.commit(0, "<p>first again</p>");
  await flush();
  state = reader.getState();
  assert.equal(state.conversation.exchanges.length, 1);
  assert.equal(state.conversation.exchanges[0].question, "about the first?");
  assert.equal(state.conversation.exchanges[0].answer, "answer");
});
