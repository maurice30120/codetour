import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as copilotJournal from "../packages/copilot-plugin/com.github.copilot/lib/run-log.mjs";
import * as piJournal from "../packages/pi-plugin/lib/journal.mjs";

// The creation journal (DESIGN §3) is read by two hooks that ship in two
// different host packages, so the reader exists twice. Two copies that disagree
// about what a record is, or about how long one may be attributed, would make
// the same journal mean different things depending on the agent — this test
// pins both copies to the same verdicts on the same fixtures.

const READERS = [
  {
    name: "copilot-plugin lib/run-log.mjs",
    isCreationRecord: copilotJournal.isCreationRecord,
    list: (workspace, now) => copilotJournal.listCreations(workspace, now),
  },
  {
    name: "pi-plugin lib/journal.mjs",
    isCreationRecord: piJournal.isCreationRecord,
    list: (workspace, now) => piJournal.readCreations(workspace, now),
  },
];

// One instant every fixture is placed around, so "expired" and "future" are
// facts of the table rather than of the machine clock.
const READ_NOW = Date.parse("2026-01-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function record(overrides = {}) {
  return {
    version: 1,
    workspace: "/tmp/workspace",
    tourPath: "/tmp/workspace/.tours/project.tour",
    tourTitle: "Payment flow",
    kind: "project",
    at: new Date(READ_NOW - HOUR).toISOString(),
    sessionId: "01a212c3-e2e1-7637-85e8-e0c0e49eed8e",
    responseId: null,
    host: "pi",
    ...overrides,
  };
}

function withoutIdentity(overrides = {}) {
  const { sessionId, responseId, host, ...rest } = record(overrides);
  return rest;
}

// `read` states what the directory read must yield: `"record"` for a record the
// reader may attribute, `"ignored"` for a foreign or expired entry that is not
// even a diagnostic.
const FIXTURES = [
  {
    label: "valid record with a session identity",
    record: record(),
    isCreationRecord: true,
    read: "record",
  },
  {
    label: "record whose identity fields are all null",
    record: record({ sessionId: null, responseId: null, host: null }),
    isCreationRecord: true,
    read: "record",
  },
  {
    label: "record without the identity fields at all",
    record: withoutIdentity(),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record whose sessionId is not a string",
    record: record({ sessionId: 42 }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record whose host is neither null nor a string",
    record: record({ host: { name: "pi" } }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record of another journal version",
    record: record({ version: 2 }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record with an empty workspace",
    record: record({ workspace: "" }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record without a title",
    record: record({ tourTitle: undefined }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record with an unparseable timestamp",
    record: record({ at: "yesterday-ish" }),
    isCreationRecord: false,
    read: "problem",
  },
  {
    label: "record stamped after the read instant",
    record: record({ at: new Date(READ_NOW + HOUR).toISOString() }),
    isCreationRecord: true,
    read: "record",
  },
  {
    label: "record older than the 24 h attribution window",
    record: record({ at: new Date(READ_NOW - 25 * HOUR).toISOString() }),
    isCreationRecord: true,
    read: "ignored",
  },
];

function workspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-journal-parity-"));
  const journal = path.join(root, ".tours", ".log", "creations");
  mkdirSync(journal, { recursive: true });
  return { root, journal };
}

function write(journal, name, value) {
  writeFileSync(
    path.join(journal, name),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8"
  );
}

test("both journal copies classify every record shape the same way", () => {
  for (const fixture of FIXTURES) {
    const verdicts = READERS.map(reader => reader.isCreationRecord(fixture.record));
    assert.deepEqual(
      new Set(verdicts).size,
      1,
      `${fixture.label}: the two copies disagree (${READERS.map(
        (reader, index) => `${reader.name}=${verdicts[index]}`
      ).join(", ")})`
    );
    assert.equal(verdicts[0], fixture.isCreationRecord, fixture.label);
  }
});

test("both journal copies reach the same verdict on one journal directory", async () => {
  const { root, journal } = workspace();
  try {
    FIXTURES.forEach((fixture, index) => {
      write(
        journal,
        `${1700000000000 + index}-1-fixture${index}.json`,
        JSON.parse(JSON.stringify(fixture.record))
      );
    });
    // A foreign file name, an unreadable document and a hidden temporary file:
    // each copy stays tolerant, and neither invents a record.
    write(journal, "notes.md", "kept\n");
    write(journal, "1700000000500-1-broken.json", "{ not json");
    write(journal, ".1700000000501-1-hidden.json.tmp", "ignored\n");

    const results = await Promise.all(READERS.map(reader => reader.list(root, READ_NOW)));
    const [copilot, pi] = results;

    assert.deepEqual(
      copilot.records.map(entry => entry.tourTitle),
      pi.records.map(entry => entry.tourTitle)
    );
    assert.deepEqual(copilot.problems, pi.problems);
    assert.deepEqual(copilot.records.length, 3, "valid, null-identity and future records");
    assert.deepEqual(copilot.problems.length, FIXTURES.filter(fixture => fixture.read === "problem").length + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("both journal copies leave an absent journal empty and quiet", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-journal-absent-"));
  try {
    const results = await Promise.all(READERS.map(reader => reader.list(root, READ_NOW)));
    for (const result of results) {
      assert.deepEqual(result.records, []);
      assert.deepEqual(result.problems, []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
