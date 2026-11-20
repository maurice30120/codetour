import { test } from "node:test";
import * as assert from "node:assert";
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_CATALOGUE, commandExists } from "./agentCatalogue";
import { probeAgentProfile } from "./agentProbe";
import { clientCapabilities, signInPlan } from "./agentAuth";
import { spawnAcpAgent, type AcpAgentProcess } from "./acpAgentProcess";
import { openAskSession, type AskSession } from "./acpSession";
import { piAcpEntry } from "./piReadonlyLauncher";

/**
 * The manual Pi smoke test of ADR 0049: the only check that runs a real Pi
 * and can therefore attest what no fake agent can — that the pinned ACP
 * client really negotiates with Pi's adapter, and that the effective tool
 * surface of the launched Pi is reading and searching, not what the launcher
 * is supposed to say.
 *
 * It is skipped by default and never blocks CI: `node --test
 * dist/test/agent/piAgentSmoke.test.js` passes without a Pi, and
 * `CODETOUR_PI_SMOKE=1` runs it (docs/pi-agent-smoke.md). Every wait is
 * bounded and every spawned process is disposed, so a hung Pi fails one test
 * instead of hanging the suite.
 */

/** The ACP error code of "authentication required": only the reader signs in. */
const AUTH_REQUIRED_CODE = -32000;

/** The real catalogue entry, launcher included. */
const PI_PROFILE = AGENT_CATALOGUE.find(profile => profile.name === "Pi");
assert.ok(PI_PROFILE, "Pi is part of the versioned catalogue");

/**
 * Pi cannot be smoked on a machine without it, without a POSIX launcher, or
 * without the reader's own sign in. All three are reported, never failed.
 */
const MISSING_COMMANDS = ["pi", "pi-acp"].filter(command => !commandExists(command));
const SKIPPED: string | false =
  process.env.CODETOUR_PI_SMOKE !== "1"
    ? "The Pi smoke test is manual: set CODETOUR_PI_SMOKE=1 to run it (docs/pi-agent-smoke.md)."
    : MISSING_COMMANDS.length > 0
      ? `Pi is not installed (missing: ${MISSING_COMMANDS.join(", ")}).`
      : process.platform === "win32"
        ? "Pi runs behind a POSIX launcher, which Windows does not provide."
        : false;

const UNAUTHENTICATED =
  "Pi asks for authentication: run `pi auth login` in a terminal and re-run (docs/pi-agent-smoke.md).";

/**
 * The extension the smoke test loads into the real Pi process: it reports the
 * tools the agent actually has active once the session starts. Pi exposes no
 * other way to read that surface — `get_state` says nothing about tools.
 */
const ACTIVE_TOOLS_EXTENSION = `import { writeFileSync } from "node:fs";

export default function logActiveTools(pi: any) {
  pi.on("session_start", () => {
    writeFileSync(process.env.CODETOUR_PI_TOOLS_LOG ?? "", JSON.stringify(pi.getActiveTools()));
  });
}
`;

/** A workspace only this test uses: Pi reads and writes nothing outside it. */
function temporaryWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "codetour-pi-smoke-"));
}

/** Runs one ACP operation under a deadline instead of waiting on a hung agent. */
async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  // A lose of the race must not surface later as an unhandled rejection.
  operation.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Pi did not answer within ${ms} ms.`)),
      ms
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs a command to its exit and returns what it said, with stdin closed: Pi
 * in print mode waits for a standard input that ends. The wait is bounded, so
 * a hung agent cannot hold the suite.
 */
function runToExit(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<string> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", chunk => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", chunk => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    child.once("error", error => {
      clearTimeout(timer);
      resolve(`${output}${error.message}`);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

/** True when Pi answered that the reader has to sign in first. */
function authenticationRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === AUTH_REQUIRED_CODE;
}

/** Spawns the real Pi adapter exactly as the reading panel launches it. */
function spawnPi(workspace: string): AcpAgentProcess {
  const entry = piAcpEntry(workspace);
  assert.ok(entry, "this platform provides Pi's read-only launcher");
  return spawnAcpAgent(entry);
}

/** A transport of Pi's adapter, and the ACP client speaking on it. */
function connectPi(workspace: string): {
  agent: AcpAgentProcess;
  connection: ReturnType<ReturnType<typeof acp.client>["connect"]>;
} {
  const agent = spawnPi(workspace);
  return { agent, connection: acp.client({ name: "codetour" }).connect(agent.stream) };
}

/**
 * What a fresh Pi session announces as its model option, or undefined when Pi
 * asks for a sign in instead. The session is disposed either way: the smoke
 * test holds no agent process between its steps.
 */
async function announcedModel(
  workspace: string
): Promise<{ value: string; values: string[] } | undefined> {
  // No client speaks on this transport before the session layer does: an ACP
  // stream takes exactly one reader.
  const agent = spawnPi(workspace);
  try {
    const session = await bounded(
      openAskSession({
        agentProfileName: "Pi",
        transport: agent,
        cwd: workspace,
        useDefaultMode: true,
        startupTimeoutMs: 60_000
      }),
      90_000
    );
    try {
      assert.ok(session.model, "Pi announces a model option");
      return {
        value: session.model.value,
        values: session.model.values.map(option => option.value)
      };
    } finally {
      await session.close();
    }
  } catch (error) {
    if (authenticationRequired(error)) return undefined;
    throw error;
  } finally {
    await agent.dispose().catch(() => undefined);
  }
}

test(
  "Pi answers the probe and negotiates the pinned protocol version",
  { skip: SKIPPED, timeout: 120_000 },
  async t => {
    const workspace = temporaryWorkspace();
    const { agent, connection } = connectPi(workspace);
    try {
      const initialized = await bounded(
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: clientCapabilities()
        }),
        30_000
      );
      // The attestation the spec asks for: the pinned client speaks protocol
      // version 1 and Pi's adapter answers that same version, rather than
      // another one it merely tolerates while the client assumes its own.
      assert.equal(initialized.protocolVersion, acp.PROTOCOL_VERSION);
      assert.equal(initialized.agentInfo?.name, "pi-acp");
      t.diagnostic(
        `protocol ${initialized.protocolVersion} negotiated with ${initialized.agentInfo?.name} ${initialized.agentInfo?.version}`
      );

      const session = await bounded(
        connection.agent.request(acp.methods.agent.session.new, {
          cwd: workspace,
          mcpServers: []
        }),
        30_000
      );
      assert.ok(session.sessionId, "Pi opened a session");
      // Pi announces the model option the panel lists and the thinking levels
      // that are why the entry keeps the agent's own mode.
      assert.ok(
        session.configOptions?.some(
          option => option.category === "model" || option.id === "model"
        ),
        "Pi announces a model option"
      );
      assert.ok(
        session.modes?.availableModes.every(mode => /thinking/i.test(mode.name)),
        "Pi's modes are thinking levels, not permissions"
      );
    } catch (error) {
      if (!authenticationRequired(error)) throw error;
      t.skip(UNAUTHENTICATED);
      return;
    } finally {
      connection.close();
      await agent.dispose();
    }

    // The same entry through the product's own Agent Probe: what the reading
    // panel establishes before it offers Pi.
    const outcome = await probeAgentProfile(PI_PROFILE, workspace);
    assert.equal(outcome.availability.state, "available");
  }
);

test(
  "the launched Pi has only reading and searching tools",
  { skip: SKIPPED, timeout: 180_000 },
  async t => {
    const workspace = temporaryWorkspace();
    const log = path.join(workspace, "active-tools.json");
    const extension = path.join(workspace, "log-active-tools.ts");
    writeFileSync(extension, ACTIVE_TOOLS_EXTENSION);
    const entry = piAcpEntry(workspace);
    assert.ok(entry, "this platform provides Pi's read-only launcher");
    const launcher = entry.env?.PI_ACP_PI_COMMAND;
    assert.ok(launcher, "Pi's entry launches CodeTour's launcher");

    // The launcher pi-acp spawns, run with the extra arguments it passes
    // through: the surface measured is the surface a conversation gets.
    const output = await runToExit(
      launcher,
      ["-e", extension, "--print", "--no-session", "--offline", "--no-themes", "Reply with OK."],
      { cwd: workspace, env: { ...process.env, CODETOUR_PI_TOOLS_LOG: log } }
    );
    if (!existsSync(log)) {
      // Pi ran no session, which on an unconnected machine is the sign-in
      // path's job, not this test's.
      t.skip(`${UNAUTHENTICATED}\n${output.trim()}`);
      return;
    }

    const tools = JSON.parse(readFileSync(log, "utf8")) as string[];
    t.diagnostic(`effective tools of the launched Pi: ${tools.join(", ")}`);
    assert.deepEqual(
      [...tools].sort(),
      ["find", "grep", "ls", "read"],
      "the effective surface is exactly the allowlist"
    );
    for (const forbidden of ["bash", "powershell", "edit", "write"]) {
      assert.ok(!tools.includes(forbidden), `the launched Pi has no ${forbidden}`);
    }
  }
);

test(
  "Pi replays the requested model, confirms it, and answers a real question",
  { skip: SKIPPED, timeout: 240_000 },
  async t => {
    const workspace = temporaryWorkspace();
    writeFileSync(
      path.join(workspace, "example.ts"),
      "export function double(n: number): number {\n  return n * 2;\n}\n"
    );
    const context = {
      filePath: "example.ts",
      description: "A function that doubles a number.",
      code: "export function double(n: number): number {\n  return n * 2;\n}\n"
    };

    // First session: what the agent announces, exactly as the probe reads it.
    const announced = await announcedModel(workspace);
    if (announced === undefined) {
      t.skip(UNAUTHENTICATED);
      return;
    }

    // The reader's choice, replayed on a new session of the same profile. A
    // value of the same provider keeps the round trip real without demanding
    // credentials the machine may not have.
    const provider = announced.value.split("/")[0];
    const requested =
      announced.values.find(
        value => value !== announced.value && value.split("/")[0] === provider
      ) ?? announced.value;

    t.diagnostic(`model announced: ${announced.value}; requested: ${requested}`);
    const second = spawnPi(workspace);
    let session: AskSession | undefined;
    try {
      session = await bounded(
        openAskSession({
          agentProfileName: "Pi",
          transport: second,
          cwd: workspace,
          useDefaultMode: true,
          startupTimeoutMs: 60_000,
          requestedModel: requested
        }),
        90_000
      );
      // Effective only once the agent confirmed it, which is the rule the
      // model selector follows (ADR 0048).
      assert.equal(session.model?.value, requested);
      assert.equal(session.identity.model, requested);

      // Back to the model the agent announced first, so the question runs on
      // the configuration the machine is known to answer with.
      const restored = await session.setModel(announced.value);
      assert.equal(restored?.value, announced.value);

      const outcome = await bounded(
        session.prompt("In one short sentence, what does double return?", context),
        120_000
      );
      assert.ok(outcome.message.trim().length > 0, "Pi answered the question");
      assert.equal(outcome.usedForbiddenTools, false, "Pi ran no editing tool");
    } catch (error) {
      if (!authenticationRequired(error)) throw error;
      t.skip(UNAUTHENTICATED);
    } finally {
      await session?.close();
      await second.dispose().catch(() => undefined);
    }
  }
);

test(
  "Pi's sign-in path is its declared terminal command",
  { skip: SKIPPED, timeout: 120_000 },
  async t => {
    const workspace = temporaryWorkspace();
    const { agent, connection } = connectPi(workspace);
    try {
      const initialized = await bounded(
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: clientCapabilities()
        }),
        30_000
      );
      const plan = signInPlan(initialized.authMethods ?? []);
      if (!plan || plan.kind !== "terminal") {
        assert.fail(`Pi declares no terminal sign-in command: ${JSON.stringify(plan)}`);
      }
      // The command the panel runs in a terminal for the reader; it is only
      // read here, never executed, because signing in stays the reader's act.
      assert.equal(plan.command, "pi-acp");
      assert.deepEqual(plan.args, ["--terminal-login"]);
      t.diagnostic(`sign-in command: ${plan.command} ${plan.args.join(" ")}`);
    } finally {
      connection.close();
      await agent.dispose();
    }
  }
);
