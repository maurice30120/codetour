import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CREATIONS_DIRECTORY,
  readCreations,
  selectCreated,
  summaryLines,
  tokenLine,
  tokenReading,
} from "../packages/pi-plugin/lib/journal.mjs";

// The creation journal as the Pi hook reads it (DESIGN §3, §4).
//
// The journal is written by `codetour create-*-tour`, one record per created
// Tour. These tests pin the reading side only: what the hook is allowed to
// attribute to the current response, and how it reads the response's tokens.

const SESSION = "01a212c3-e2e1-7637-85e8-e0c0e49eed8e";

// The instant the journal fixtures are read at. Records older than the 24 h
// attribution window are dropped, so the read instant travels with the
// fixtures instead of depending on the machine clock.
const READ_NOW = Date.parse("2026-01-01T12:00:00.000Z");

function workspace(directory = "work space") {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-pi-journal-"));
  const ws = path.join(root, directory);
  mkdirSync(ws, { recursive: true });
  // The canonical spelling the CLI records and the hook compares against
  // (ADR 0056).
  return { root, workspace: realpathSync.native(ws) };
}

function record(overrides = {}) {
  return {
    version: 1,
    workspace: "/tmp/workspace",
    tourPath: "/tmp/workspace/.tours/project.tour",
    tourTitle: "Payment flow",
    kind: "project",
    at: "2026-01-01T10:00:00.000Z",
    sessionId: SESSION,
    responseId: null,
    host: "pi",
    ...overrides,
  };
}

function writeRecord(ws, name, value) {
  const directory = path.join(ws, ...CREATIONS_DIRECTORY.split(path.sep));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, name),
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8"
  );
}

test("every readable creation record of the journal is read", async () => {
  const { root, workspace: ws } = workspace();
  try {
    writeRecord(ws, "1700000000000-1-aaaa.json", record({ workspace: ws }));
    writeRecord(ws, "1700000000001-1-bbbb.json", record({ workspace: ws, tourTitle: "Renderer" }));
    const { records, problems } = await readCreations(ws, READ_NOW);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      records.map(entry => entry.tourTitle),
      ["Payment flow", "Renderer"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable or foreign entry is reported, never read as a creation", async () => {
  const { root, workspace: ws } = workspace();
  try {
    writeRecord(ws, "1700000000000-1-aaaa.json", record({ workspace: ws }));
    writeRecord(ws, "1700000000001-1-bbbb.json", "{ not json");
    writeRecord(ws, "1700000000002-1-cccc.json", { version: 1, workspace: ws });
    writeRecord(ws, "notes.md", "kept\n");
    const { records, problems } = await readCreations(ws, READ_NOW);
    assert.equal(records.length, 1);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /1700000000001-1-bbbb\.json/);
    assert.match(problems[1], /1700000000002-1-cccc\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a record older than the 24 h attribution window is dropped, not reported", async () => {
  const { root, workspace: ws } = workspace();
  try {
    writeRecord(
      ws,
      "1700000000000-1-aaaa.json",
      record({ workspace: ws, at: new Date(READ_NOW - 25 * 60 * 60 * 1000).toISOString() })
    );
    writeRecord(
      ws,
      "1700000000001-1-bbbb.json",
      record({ workspace: ws, at: new Date(READ_NOW - 60 * 1000).toISOString() })
    );
    const { records, problems } = await readCreations(ws, READ_NOW);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      records.map(entry => entry.tourPath),
      ["/tmp/workspace/.tours/project.tour"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a workspace that never created a Tour has an empty journal, not a failure", async () => {
  const { root, workspace: ws } = workspace();
  try {
    assert.deepEqual(await readCreations(ws), { records: [], problems: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the creation of this session and workspace is attributed to the response", () => {
  const created = record();
  const selected = selectCreated([created], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: Date.parse("2026-01-01T09:59:00.000Z"),
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(selected, [created]);
});

test("another session's creation is never attributed", () => {
  const selected = selectCreated([record({ sessionId: "other-session" })], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: 0,
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(selected, []);
});

test("a creation without a session identity is never attributed", () => {
  const selected = selectCreated([record({ sessionId: null })], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: 0,
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(selected, []);
});

test("a creation of another workspace is never attributed", () => {
  const selected = selectCreated([record({ workspace: "/tmp/elsewhere" })], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: 0,
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(selected, []);
});

test("a creation older than the response is never attributed", () => {
  const selected = selectCreated([record()], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: Date.parse("2026-01-01T10:00:01.000Z"),
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(selected, []);
});

test("a creation stamped after the response ended is never attributed", () => {
  const selected = selectCreated([record()], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: 0,
    now: Date.parse("2026-01-01T09:59:59.000Z"),
  });
  assert.deepEqual(selected, []);
});

test("every creation of the response is attributed, not just the last one", () => {
  const first = record();
  const second = record({
    at: "2026-01-01T10:00:02.000Z",
    tourPath: "/tmp/workspace/.tours/changes.tour",
    tourTitle: "Renderer changes",
    kind: "changes",
  });
  const older = record({ at: "2026-01-01T09:00:00.000Z", tourTitle: "Old" });
  const selected = selectCreated([second, older, first], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: Date.parse("2026-01-01T09:59:00.000Z"),
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.deepEqual(
    selected.map(entry => entry.tourTitle),
    ["Payment flow", "Renderer changes"]
  );
});

test("a creation recorded twice is reported once", () => {
  const created = record();
  const selected = selectCreated([created, { ...created }], {
    workspace: "/tmp/workspace",
    sessionId: SESSION,
    since: 0,
    now: Date.parse("2026-01-01T10:00:05.000Z"),
  });
  assert.equal(selected.length, 1);
});

test("the summary names the title and the absolute path of every created Tour", () => {
  assert.deepEqual(
    summaryLines([
      record(),
      record({ tourPath: "/tmp/workspace/.tours/changes.tour", tourTitle: "Renderer changes" }),
    ]),
    [
      'CodeTour: "Payment flow" (/tmp/workspace/.tours/project.tour)',
      'CodeTour: "Renderer changes" (/tmp/workspace/.tours/changes.tour)',
    ]
  );
  // No creation identified: the hook prints nothing.
  assert.deepEqual(summaryLines([]), []);
});

// The usage figures Pi exposes on every assistant message
// (`Usage` of @earendil-works/pi-ai): `input` already excludes the cache, and
// `totalTokens = input + output + cacheRead + cacheWrite`.
const TURN_1 = { input: 1522, output: 118, cacheRead: 0, cacheWrite: 0, totalTokens: 1640 };
const TURN_2 = { input: 142, output: 35, cacheRead: 1536, cacheWrite: 0, totalTokens: 1713 };

test("one response reading splits input, output and cache without double counting", () => {
  const reading = tokenReading([TURN_1, TURN_2]);
  assert.deepEqual(reading, {
    available: true,
    input: 1664,
    output: 153,
    cache: 1536,
    approximate: false,
  });
});

test("cache reads and cache writes are one cache figure", () => {
  const reading = tokenReading([{ ...TURN_2, cacheRead: 1000, cacheWrite: 200 }]);
  assert.equal(reading.cache, 1200);
  assert.equal(reading.input, 142);
});

test("an all-zero usage is unavailable, never zero", () => {
  const reading = tokenReading([
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  ]);
  assert.equal(reading.available, false);
  assert.equal(tokenLine(reading), "CodeTour tokens: unavailable for this response.");
});

test("no usage at all is unavailable, never zero", () => {
  assert.equal(tokenReading([]).available, false);
  assert.equal(tokenReading(undefined).available, false);
});

test("a partial reading is reported as approximate", () => {
  const reading = tokenReading([TURN_1, undefined]);
  assert.equal(reading.approximate, true);
  assert.equal(reading.available, true);
  assert.equal(
    tokenLine(reading),
    "CodeTour tokens (approximate): input 1,522 / output 118 / cache 0"
  );
});

test("the response reading states its three figures once", () => {
  assert.equal(
    tokenLine(tokenReading([TURN_1, TURN_2])),
    "CodeTour tokens: input 1,664 / output 153 / cache 1,536"
  );
  // A fallback source (the session entries, not the run's own messages) keeps
  // its scope visible.
  assert.equal(
    tokenLine(tokenReading([TURN_1], { approximate: true })),
    "CodeTour tokens (approximate): input 1,522 / output 118 / cache 0"
  );
});
