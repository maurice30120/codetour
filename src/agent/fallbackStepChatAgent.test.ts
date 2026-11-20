import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { AcpAgentEntry } from "./acpAgentProcess";
import { AgentSelection, type AgentProfile } from "./agentCatalogue";
import { createFallbackStepChatResponder } from "./fallbackStepChatAgent";
import {
  StepChatAgentUnavailableError,
  type StepChatRequest
} from "./stepChatContract";

/**
 * The ordered responder is the seam that decides which Agent Profile answers a
 * question. Its rules are tested against real fake ACP agent processes at the
 * transport boundary: each agent's log proves who was launched, who was asked,
 * and — after the first answer settled — who was never tried again.
 */

const fakeAgentScript = path.join(__dirname, "fakeAcpAgent.js");

interface AgentWorkspace {
  workspace: string;
  logPath: string;
  cleanup(): Promise<void>;
}

function createWorkspace(): AgentWorkspace {
  const workspace = mkdtempSync(path.join(tmpdir(), "codetour-fallback-"));
  return {
    workspace,
    logPath: path.join(workspace, "agent.log"),
    // A released agent may keep its working directory locked briefly on
    // Windows while the process exits.
    cleanup: () =>
      rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  };
}

function fakeAgentEntry(agent: AgentWorkspace, behavior?: string): AcpAgentEntry {
  return {
    command: process.execPath,
    args: behavior
      ? [fakeAgentScript, agent.logPath, behavior]
      : [fakeAgentScript, agent.logPath],
    cwd: agent.workspace
  };
}

interface FakeAgentLogRecord {
  method: string;
  params?: Record<string, unknown>;
  outcome?: string;
}

function readLog(logPath: string): FakeAgentLogRecord[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as FakeAgentLogRecord);
  } catch {
    return [];
  }
}

async function waitForLog(
  logPath: string,
  predicate: (records: FakeAgentLogRecord[]) => boolean
): Promise<FakeAgentLogRecord[]> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const records = readLog(logPath);
    if (predicate(records)) {
      return records;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the fake agent log");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function promptCount(records: FakeAgentLogRecord[]): number {
  return records.filter(record => record.method === "session/prompt").length;
}

/** A profile that can never be launched: this Node binary, a missing script. */
function unlaunchableProfile(name: string, rank: number, workspace: string): AgentProfile {
  return {
    name,
    rank,
    entry: cwd => ({
      command: process.execPath,
      args: [path.join(workspace, "codetour-absent-agent.js")],
      cwd
    })
  };
}

function question(workspaceRoot: string, text: string): StepChatRequest {
  return {
    question: text,
    context: { available: false, description: "A tour step" },
    history: [],
    workspaceRoot
  };
}

test("a second question is retried on the profile that answered, never on the next one", async () => {
  const first = createWorkspace();
  const second = createWorkspace();
  const responder = createFallbackStepChatResponder(() => [
    { name: "Vibe", entry: fakeAgentEntry(first, "exit-after-answer") },
    { name: "Copilot", entry: fakeAgentEntry(second) }
  ]);
  try {
    assert.match(
      await responder.answer(question(first.workspace, "Qui répond ?")),
      /Tour answer/
    );

    // The agent that answered dies once its answer was written.
    await waitForLog(first.logPath, records =>
      records.some(record => record.method === "agent-exit")
    );
    await new Promise(resolve => setTimeout(resolve, 100));

    // The next question finds a dead transport: it is attached to that
    // exchange and never handed to another Agent Profile (ADR 0048).
    await assert.rejects(
      Promise.resolve(responder.answer(question(first.workspace, "Et maintenant ?"))),
      (error: unknown) => {
        assert.ok(error instanceof StepChatAgentUnavailableError);
        assert.match((error as Error).message, /Vibe : /);
        // The exhausted-candidates parenthetical derives from the catalogue.
        assert.match(
          (error as Error).message,
          /\(Copilot → Vibe → Pi → Codex → Claude Code\)/
        );
        return true;
      }
    );
    assert.deepEqual(
      readLog(second.logPath),
      [],
      "the next profile is never launched after the first answer settled"
    );
    // The profile that answered stays the one a later question would ask.
    assert.deepEqual(responder.identity?.(), { agent: "Vibe", effective: false });
  } finally {
    await responder.dispose?.();
    await first.cleanup();
    await second.cleanup();
  }
});

test("a conversation failure degrades only the faulty profile, without probing anything", async () => {
  const agent = createWorkspace();
  const probed: string[] = [];
  const selection = new AgentSelection({
    profiles: [
      unlaunchableProfile("Copilot", 0, agent.workspace),
      { name: "Vibe", rank: 1, entry: () => fakeAgentEntry(agent) }
    ],
    probe: async profile => {
      probed.push(profile.name);
      return { availability: { state: "available", configOptions: [] } };
    }
  });
  const responder = createFallbackStepChatResponder(
    cwd => selection.candidates(cwd),
    {
      whenReady: () => selection.whenInitialProbeSettled(),
      onConversationStarted: () => selection.hasConversationStarted(),
      onProfileFailed: (name, reason) => selection.degrade(name, reason)
    }
  );
  const stateOf = (name: string) =>
    selection.profiles().find(view => view.profile.name === name)!.availability;
  try {
    await selection.probeInitial(agent.workspace);
    await selection.probeUnverified(agent.workspace);
    assert.deepEqual(probed, ["Copilot", "Vibe"]);

    // The initial selection may fall through: the preselected Copilot cannot
    // be launched, so Vibe answers the first question.
    assert.match(
      await responder.answer(question(agent.workspace, "Première question")),
      /Tour answer/
    );

    // Only the profile that failed is degraded, with its failure's reason;
    // the neighbour keeps the state the probe established and nothing is
    // probed by a conversation failure.
    assert.deepEqual(probed, ["Copilot", "Vibe"], "a conversation failure probes nothing");
    const copilot = stateOf("Copilot");
    assert.equal(copilot.state, "connection-error");
    if (copilot.state === "connection-error") {
      assert.ok(copilot.reason.length > 0, "the failure's reason is kept");
    }
    assert.equal(stateOf("Vibe").state, "available");
    // The selection itself is untouched: the reader's choice never moves on a
    // failure.
    assert.equal(selection.selectedProfile()?.profile.name, "Copilot");

    // The following question stays with the agent that answered.
    assert.match(
      await responder.answer(question(agent.workspace, "Deuxième question")),
      /Tour answer/
    );
    assert.equal(promptCount(readLog(agent.logPath)), 2);
    assert.deepEqual(probed, ["Copilot", "Vibe"]);
  } finally {
    await responder.dispose?.();
    selection.dispose();
    await agent.cleanup();
  }
});
