#!/usr/bin/env node
// CI diagnostic lane for the run-log contract (test.yml, workflow_dispatch).
//
// The run state's `workspace` is written by the MCP server and compared by the
// Copilot/Pi hooks, so a machine-specific spelling — an 8.3 short path, a
// mapped drive, a symlinked checkout — can make one surface miss what the other
// wrote. This script replays that chain and prints every spelling instead of
// leaving the mismatch to guesswork. It touches nothing in the repository: it
// works in a throwaway directory under the OS temporary directory.
//
// Usage: node scripts/diagnose-run-log.mjs [--json]
//
// Requires the built MCP server (`npm run build --prefix packages/mcp-server`)
// for the write half; without it the hook half still runs and says so.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { readdir as readdirPromises, realpath as realpathPromises } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repository = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(
  repository,
  "packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs"
);
const MCP_RUN_LOG = path.join(repository, "packages/mcp-server/dist/src/run-log.js");
const RUN_ID = "diagnose-run-0001";
const SESSION_ID = "session-0123456789abcdef";
const LOG_DIRECTORY = path.join(".tours", ".log");
const FILE_PREFIX = "codetour-run-";
const asJson = process.argv.includes("--json");

const findings = [];
function add(label, value) {
  findings.push([label, value === undefined ? "(absent)" : String(value)]);
}

/** The state file as the last writer left it, or undefined. */
function readState(root) {
  try {
    return JSON.parse(
      readFileSync(path.join(root, LOG_DIRECTORY, `${FILE_PREFIX}${RUN_ID}.json`), "utf8")
    );
  } catch {
    return undefined;
  }
}

/** Removes the run state so each probe starts from the same clean slate. */
function resetState(root) {
  rmSync(path.join(root, LOG_DIRECTORY, `${FILE_PREFIX}${RUN_ID}.json`), { force: true });
}

/** The seeded state a controlled generation leaves before its Tour exists. */
function seedState(root, workspace) {
  const at = new Date().toISOString();
  mkdirSync(path.join(root, LOG_DIRECTORY), { recursive: true });
  writeFileSync(
    path.join(root, LOG_DIRECTORY, `${FILE_PREFIX}${RUN_ID}.json`),
    `${JSON.stringify(
      {
        version: 1,
        runId: RUN_ID,
        workspace,
        sessionId: SESSION_ID,
        kind: "project",
        request: "diagnose",
        at,
        updatedAt: at,
        tourCreated: false,
        tourPath: null,
        tourTitle: null,
        consolidation: null,
        continuationUsed: false
      },
      null,
      2
    )}\n`
  );
}

/** One hook run against the given cwd, as the host invokes it. */
function hookDecision(cwd, transcriptPath = path.join(cwd, "transcript.jsonl")) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      sessionId: SESSION_ID,
      cwd,
      transcriptPath,
      stopReason: "end_turn",
      stop_hook_active: false
    }),
    encoding: "utf8",
    timeout: 60000
  });
  const stdout = (result.stdout || "").trim();
  let decision = "(unparseable)";
  try {
    decision = JSON.stringify(JSON.parse(stdout));
  } catch {
    // A hook that does not speak the protocol is itself the finding.
  }
  return {
    decision,
    stderr: (result.stderr || "").trim().split("\n").filter(Boolean).slice(0, 3)
  };
}

async function main() {
  const raw = mkdtempSync(path.join(os.tmpdir(), "codetour-diagnose-"));
  const real = realpathSync(raw);
  try {
    add("platform", process.platform);
    add("node", process.version);
    add("cwd (as given)", raw);
    add("cwd realpath", real);
    add("cwd === realpath", raw === real ? "yes" : "NO — two spellings exist");

    const writer = existsSync(MCP_RUN_LOG)
      ? (await import(pathToFileURL(MCP_RUN_LOG).href)).updateRunState
      : undefined;
    if (!writer) add("mcp-server write half", "skipped: dist/src/run-log.js is absent");

    // Each probe starts from a clean state and reports what the writer stored
    // and what the hook then decided: the pair is the finding, not the step.
    // The transcript variant separates a usage-metrics failure (the hook's own
    // write, with its lock) from a workspace-spelling mismatch.
    const probes = [
      { label: "write(realpath) then hook(cwd=raw)", written: real, cwd: raw },
      { label: "write(realpath)+transcript then hook(cwd=raw)", written: real, cwd: raw, transcript: true },
      { label: "write(raw) then hook(cwd=realpath)", written: raw, cwd: real },
      { label: "write(raw) then hook(cwd=raw)", written: raw, cwd: raw }
    ];
    for (const probe of probes) {
      resetState(raw);
      seedState(raw, probe.written);
      if (writer) {
        const updated = await writer(raw, RUN_ID, "project", state => ({
          ...state,
          tourCreated: true,
          tourPath: ".tours/diagnose.tour",
          tourTitle: "Diagnose"
        }));
        if (!updated.persisted) add(`${probe.label}: write`, `refused (${updated.reason})`);
      }
      add(`${probe.label}: state workspace`, readState(raw)?.workspace);
      add(`${probe.label}: state tourCreated`, readState(raw)?.tourCreated);
      const transcriptPath = probe.transcript
        ? path.join(raw, "present-transcript.jsonl")
        : path.join(raw, "transcript.jsonl");
      if (probe.transcript) {
        writeFileSync(transcriptPath, '{"type":"assistant","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n');
      }
      const result = hookDecision(probe.cwd, transcriptPath);
      add(`${probe.label}: decision`, result.decision === "{}" ? "{} (not matched)" : result.decision);
      for (const line of result.stderr) add(`${probe.label}: stderr`, line);
      const after = readState(raw);
      add(`${probe.label}: continuationUsed after hook`, after?.continuationUsed);
      add(`${probe.label}: metrics after hook`, after?.metrics ? "recorded" : "none");
    }

    // The library view: what the hook's own module sees when it lists the
    // directory the state was written into. This separates "the hook never
    // reached the directory" from "the state was read and rejected".
    const library = await import(
      pathToFileURL(path.join(repository, ".github/extensions/codetour/run-log.mjs")).href
    );
    const asyncReal = await realpathPromises(raw);
    add("fs/promises realpath", asyncReal);
    add("runLogDirectory(real)", library.runLogDirectory(asyncReal));
    add("run state file exists", existsSync(library.runStatePath(asyncReal, RUN_ID)) ? "yes" : "NO");
    try {
      add("directory entries", (await readdirPromises(library.runLogDirectory(asyncReal))).join(", "));
    } catch (error) {
      add("directory entries", `unreadable: ${error?.code || error?.message}`);
    }
    const listed = await library.listRunStates(asyncReal);
    add("listRunStates states", listed.states.length);
    add("listRunStates problems", listed.problems.join(" | ") || "none");
    const readBack = await library.readRunStateFile(library.runStatePath(asyncReal, RUN_ID));
    add("readRunStateFile reason", readBack.state ? "ok" : readBack.reason);
    add("readRunStateFile workspace", readBack.state?.workspace);
    add("RUN_STATE_VERSION", library.RUN_STATE_VERSION);

    if (asJson) {
      console.log(JSON.stringify(Object.fromEntries(findings), null, 2));
    } else {
      const width = Math.max(...findings.map(([label]) => label.length));
      console.log(findings.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n"));
    }
  } finally {
    rmSync(raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(`diagnose-run-log failed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
