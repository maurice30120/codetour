import { test } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createSystemSpeech } from "./SystemSpeech";

/**
 * The real-engine smoke test of spec #79, ticket 04: it speaks out loud
 * through the machine's `say`, so it never runs in the default suite. Opt in
 * on macOS with CODETOUR_SPEECH_SMOKE=1.
 */
const skip = process.platform !== "darwin" ||
  process.env.CODETOUR_SPEECH_SMOKE !== "1" ||
  // An explicit speech command would smoke the override, not the real voice.
  !!process.env.CODETOUR_SPEECH_COMMAND;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test("the real macOS voice speaks an utterance to completion", { skip }, async () => {
  const speech = createSystemSpeech();
  const speaking = speech.speak("CodeTour narration smoke test.");
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("say did not finish in time")), 30000));
  await Promise.race([speaking, deadline]);
});

test("closing the reader's engine cuts the real voice and nothing resumes", { skip }, async () => {
  // A marker inside the utterance makes the say process findable by its
  // command line: argv data, exactly where the reader puts it.
  const marker = "codetour-smoke-utterance-" + Date.now();
  const longText = (marker + " this sentence repeats to keep the voice busy. ").repeat(40);
  const speech = createSystemSpeech();
  const speaking = speech.speak(longText);
  await sleep(1000);
  speech.dispose();
  await speaking;
  // A killed voice stays dead: no process of the utterance is left or resumed.
  await sleep(2000);
  let survivors = "";
  try {
    survivors = execFileSync("pgrep", ["-fl", marker], { encoding: "utf8" });
  } catch {
    // pgrep exits 1 when nothing matches: the expected outcome.
  }
  assert.equal(survivors.trim(), "");
});
