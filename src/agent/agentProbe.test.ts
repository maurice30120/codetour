import { test } from "node:test";
import * as assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import type { AgentProfile } from "./agentCatalogue";
import { spawnAcpAgent } from "./acpAgentProcess";
import {
  AGENT_PROBE_TIMEOUT_MS,
  authenticateAgentProfile,
  probeAgentProfile
} from "./agentProbe";

/**
 * The Agent Probe is tested at its real boundary: a deterministic fake ACP
 * agent runs as a separate process and records what the probe asked it, and
 * an absent executable covers the profile the platform does not have.
 */

const fakeAgentScript = path.join(__dirname, "fakeAcpAgent.js");

interface FakeAgentLogRecord {
  method: string;
  params?: Record<string, unknown>;
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

test("the probe announces the terminal authentication capability and keeps the methods it unlocks", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const outcome = await probeAgentProfile(
      fakeAgentProfile(workspace, "auth-terminal"),
      workspace
    );

    // The capability is on the wire, not only in the outcome: the fake agent
    // announces its terminal method only to a client that sends it.
    const initialize = readLog(path.join(workspace, "agent.log")).find(
      record => record.method === "initialize"
    )!;
    const capabilities = initialize.params!.clientCapabilities as Record<
      string,
      unknown
    >;
    assert.deepEqual(capabilities._meta, { "terminal-auth": true });
    assert.equal(
      (capabilities.fs as { readTextFile?: boolean }).readTextFile,
      true
    );

    // A probe never authenticates anything on its own: it only asks, and the
    // reader's own Sign in action is the one that connects the agent.
    assert.deepEqual(
      readLog(path.join(workspace, "agent.log")).map(record => record.method),
      ["agent-process", "initialize", "session/new"]
    );

    // The announced terminal method keeps the command the reader's Sign in
    // action runs, and the state still comes from the error code alone.
    assert.equal(outcome.availability.state, "auth-required");
    assert.deepEqual(outcome.authMethods, [
      {
        id: "terminal-login",
        name: "Fake terminal sign in",
        type: "terminal",
        args: [],
        _meta: {
          "terminal-auth": {
            command: "codetour-fake-login",
            args: ["--connect"],
            env: { CODETOUR_FAKE_AUTH: "1" },
            label: "Fake agent sign in"
          }
        }
      }
    ]);
  } finally {
    cleanup();
  }
});

test("a terminal authentication method is offered only to a client that announces the capability", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const entry = fakeAgentProfile(workspace, "auth-terminal").entry(workspace)!;
    const agent = spawnAcpAgent(entry);
    const connection = acp.client({ name: "codetour" }).connect(agent.stream);
    try {
      // A client that cannot run a terminal command is told nothing: the
      // method is gated on the capability, so the probe's own capability is
      // what makes the Sign in action possible at all.
      const initialized = await connection.agent.request(
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true } }
        }
      );
      assert.deepEqual(initialized.authMethods ?? [], []);
    } finally {
      connection.close();
      await agent.dispose().catch(() => undefined);
    }
  } finally {
    cleanup();
  }
});

test("the agent-handled authenticate method connects the agent, and the next probe observes it", async () => {
  const { workspace, cleanup } = createWorkspace();
  try {
    const profile = fakeAgentProfile(workspace, "auth-once");
    const before = await probeAgentProfile(profile, workspace);
    assert.equal(before.availability.state, "auth-required");
    assert.deepEqual(before.authMethods?.map(method => method.id), ["copilot-login"]);

    // The fallback the reader's Sign in action uses when no terminal method is
    // declared: initialize then authenticate, on a transport of its own.
    await authenticateAgentProfile(profile, workspace, "copilot-login");

    const after = await probeAgentProfile(profile, workspace);
    assert.equal(after.availability.state, "available");

    const records = readLog(path.join(workspace, "agent.log"));
    const authenticate = records.find(record => record.method === "authenticate")!;
    assert.deepEqual(authenticate.params, { methodId: "copilot-login" });
    // The fallback never opens a session and never asks the agent anything.
    assert.equal(
      records.some(record => record.method === "session/prompt"),
      false
    );
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
