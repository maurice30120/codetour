import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { AgentProfile } from "./agentCatalogue";
import { AGENT_PROBE_TIMEOUT_MS, probeAgentProfile } from "./agentProbe";

/**
 * The Agent Probe is tested at its real boundary: a deterministic fake ACP
 * agent runs as a separate process and records what the probe asked it, and
 * an absent executable covers the profile the platform does not have.
 */

const fakeAgentScript = path.join(__dirname, "fakeAcpAgent.js");

interface FakeAgentLogRecord {
  method: string;
  outcome?: string;
  pid?: number;
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

function fakeAgentProfile(
  workspace: string,
  behavior?: string
): AgentProfile {
  const logPath = path.join(workspace, "agent.log");
  return {
    name: "Copilot",
    rank: 0,
    entry: cwd => ({
      command: process.execPath,
      args: behavior ? [fakeAgentScript, logPath, behavior] : [fakeAgentScript, logPath],
      cwd
    })
  };
}

function createWorkspace(): { workspace: string; cleanup: () => void } {
  const workspace = mkdtempSync(path.join(tmpdir(), "codetour-probe-"));
  return {
    workspace,
    cleanup: () => rmSync(workspace, { recursive: true, force: true })
  };
}

test("an agent that answers the handshake is available with its configuration options", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(fakeAgentProfile(workspace), workspace);

    assert.deepEqual(outcome.availability, { state: "available", configOptions: [] });
    // The probe stops after the session exists: no prompt is ever sent, and
    // no mode is selected on the session it throws away.
    const records = readLog(path.join(workspace, "agent.log"));
    assert.deepEqual(
      records.map(record => record.method),
      ["agent-process", "initialize", "session/new"]
    );
    // Only the state and the configuration options survive: the probe's
    // session is released at once, so no agent process is left for a panel
    // that may never ask anything.
    assert.equal(isRunning(records[0].pid!), false);
  } finally {
    cleanup();
  }
});

test("the probe deadline is its own 5 s, not a conversation's startup", () => {
  // A conversation is allowed 30 s to start (acpSession); a probe is not.
  assert.equal(AGENT_PROBE_TIMEOUT_MS, 5_000);
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("an absent executable is not installed and is never started", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      { name: "Codex", rank: 2, entry: cwd => ({ command: "codetour-absent-agent", cwd }) },
      workspace
    );
    assert.deepEqual(outcome.availability, { state: "not-installed" });
  } finally {
    cleanup();
  }
});

test("an ACP authentication error code is read as authentication required", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      fakeAgentProfile(workspace, "auth-required"),
      workspace
    );

    // The state is read from the error code, and the announcement of the
    // handshake keeps the methods the reader can be offered.
    assert.deepEqual(outcome.availability, {
      state: "auth-required",
      authMethods: []
    });
    assert.deepEqual(outcome.authMethods, [
      { id: "copilot-login", name: "Copilot login", description: null }
    ]);
  } finally {
    cleanup();
  }
});

test("an agent that only says authentication in words is a connection error", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      fakeAgentProfile(workspace, "auth-text-only"),
      workspace
    );

    // The message text of a foreign error code is never interpreted.
    assert.equal(outcome.availability.state, "connection-error");
  } finally {
    cleanup();
  }
});

test("an agent that exceeds the probe deadline is a connection error, not a verdict", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      fakeAgentProfile(workspace, "silent-start"),
      workspace,
      { timeoutMs: 150 }
    );

    assert.deepEqual(outcome.availability, {
      state: "connection-error",
      reason: "The agent did not answer the probe within 150 ms."
    });
  } finally {
    cleanup();
  }
});

test("a profile with no launcher on this platform reports a connection error", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      { name: "Pi", rank: 2, entry: () => undefined },
      workspace
    );
    assert.equal(outcome.availability.state, "connection-error");
  } finally {
    cleanup();
  }
});
