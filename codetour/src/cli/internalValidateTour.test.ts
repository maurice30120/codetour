import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInternalValidateTour, ValidationCommandIO, ValidationDeps } from "./internalValidateTour";

/**
 * The post-creation validation surface: the CLI owns the I/O and the exit
 * contract (one JSON document on stdout, 0 valid, 1 invalid, 2 usage or IO),
 * while the validation rules themselves live in the shared
 * `codetour-tour-generation` package and are injected here as a fake.
 */

interface RecordingIO extends ValidationCommandIO {
  outText: string;
  errText: string;
}

function recordingIO(): RecordingIO {
  const io: RecordingIO = {
    outText: "",
    errText: "",
    out: (text: string) => {
      io.outText += text;
    },
    err: (text: string) => {
      io.errText += text;
    }
  };
  return io;
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-internal-validate-"));
  mkdirSync(path.join(root, ".tours"), { recursive: true });
  const tourPath = path.join(root, ".tours", "t.tour");
  writeFileSync(tourPath, '{"title":"Validation Tour","steps":[]}');
  return { root, tourPath };
}

function fakeDeps(result: Record<string, unknown>): ValidationDeps & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    revalidate: (text: string, workspaceRoot: string) => {
      calls.push([text, workspaceRoot]);
      return result as never;
    }
  };
}

test("a valid Tour prints one document and exits 0", async () => {
  const data = fixture();
  const deps = fakeDeps({
    ok: true,
    title: "Validation Tour",
    stepCount: 2,
    issues: [],
    warnings: []
  });
  const io = recordingIO();
  const code = await runInternalValidateTour(data.tourPath, data.root, io, deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(io.outText), {
    ok: true,
    title: "Validation Tour",
    stepCount: 2,
    issues: [],
    warnings: []
  });
  assert.deepEqual(deps.calls, [[
    '{"title":"Validation Tour","steps":[]}',
    data.root
  ]]);
});

test("an invalid Tour prints its issues and exits 1", async () => {
  const data = fixture();
  const deps = fakeDeps({
    ok: false,
    issues: [{ path: "steps.1.pattern", message: "must match exactly one occurrence" }],
    warnings: []
  });
  const io = recordingIO();
  const code = await runInternalValidateTour(data.tourPath, data.root, io, deps);
  assert.equal(code, 1);
  const doc = JSON.parse(io.outText);
  assert.equal(doc.ok, false);
  assert.equal(doc.issues[0].path, "steps.1.pattern");
});

test("an unusable workspace is a usage failure with no document on stdout", async () => {
  const data = fixture();
  const deps = fakeDeps({
    ok: false,
    usageError: "the workspace is unusable: not a directory",
    issues: [],
    warnings: []
  });
  const io = recordingIO();
  const code = await runInternalValidateTour(data.tourPath, data.root, io, deps);
  assert.equal(code, 2);
  assert.equal(io.outText, "");
  assert.ok(io.errText.includes("not a directory"));
});

test("an unreadable Tour file is a usage failure and never reaches the validator", async () => {
  const data = fixture();
  const deps = fakeDeps({ ok: true, issues: [], warnings: [] });
  const io = recordingIO();
  const code = await runInternalValidateTour(
    path.join(data.root, ".tours", "missing.tour"),
    data.root,
    io,
    deps
  );
  assert.equal(code, 2);
  assert.equal(io.outText, "");
  assert.ok(io.errText.length > 0);
  assert.equal(deps.calls.length, 0);
});
