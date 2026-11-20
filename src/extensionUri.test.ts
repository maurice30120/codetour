import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { createVscodeHost, Uri } from "./test/vscodeHost";

const host = createVscodeHost();
let discoveries = 0;
const tours: Array<{ id: string }> = [];
const started: Array<{ tour: { id: string }; step: number }> = [];
(host.vscode as unknown as { UIKind: object }).UIKind = { Web: 2, Desktop: 1 };
(host.vscode.workspace as unknown as { onDidChangeWorkspaceFolders: () => void }).onDidChangeWorkspaceFolders = () => undefined;
const originalLoad = (nodeModule as unknown as { _load: Function })._load;
(nodeModule as unknown as { _load: Function })._load = function (request: string, ...args: unknown[]) {
  if (request === "vscode") return host.vscode;
  const parent = args[0] as { filename?: string } | undefined;
  if (parent?.filename?.endsWith("/extension.js")) {
    if (request === "./store/provider") return { discoverTours: async () => { discoveries++; } };
    if (request === "./store") return { store: { tours } };
    if (request === "./store/actions") return { startCodeTour: (tour: { id: string }, step: number) => started.push({ tour, step }) };
  }
  return originalLoad.apply(this, [request, ...args]);
};

let URIHandler: typeof import("./extension").URIHandler;
try {
  ({ URIHandler } = require("./extension"));
} finally {
  (nodeModule as unknown as { _load: Function })._load = originalLoad;
}

test("an opening intended for another workspace is refused visibly", async () => {
  const handler = new URIHandler();
  await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ workspace: "/another-workspace", tour: ".tours/demo.tour", step: "1" }).toString()) as never);
  assert.ok(host.messages.some((message: string) => /workspace/i.test(message)));
  assert.equal(discoveries, 0);
});

test("an opening for the current workspace proceeds to Tour discovery", async () => {
  const handler = new URIHandler();
  await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ workspace: host.rootUri.fsPath, tour: ".tours/demo.tour", step: "1" }).toString()) as never);
  assert.equal(discoveries, 1);
});

test("a multi-root workspace opens the requested root's Tour and Step", async () => {
  const otherRoot = "/other-root";
  host.vscode.workspace.workspaceFolders.push({ uri: Uri.file(otherRoot), name: "other", index: 1 });
  tours.push({ id: Uri.file("/workspace/.tours/demo.tour").toString() });
  tours.push({ id: Uri.file("/other-root/.tours/demo.tour").toString() });
  const handler = new URIHandler();
  await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ workspace: otherRoot, tour: ".tours/demo.tour", step: "2" }).toString()) as never);
  assert.deepEqual(started.at(-1), { tour: tours[1], step: 1 });
});

test("a legacy Tour URI without a workspace remains readable", async () => {
  const handler = new URIHandler();
  await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ tour: ".tours/demo.tour", step: "1" }).toString()) as never);
  assert.deepEqual(started.at(-1), { tour: tours[0], step: 0 });
});

test("a missing Tour in the requested workspace is reported", async () => {
  const handler = new URIHandler();
  const before = started.length;
  host.messages.length = 0;
  await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ workspace: "/other-root", tour: ".tours/missing.tour", step: "1" }).toString()) as never);
  assert.equal(started.length, before);
  assert.ok(host.messages.some(message => /tour/i.test(message)));
});

test("a Tour whose decoded identifier contains URL delimiters is opened", async () => {
  for (const name of ["demo#review.tour", "demo?review.tour", "demo%review.tour"]) {
    const tour = { id: `file:///other-root/.tours/${name}` };
    tours.push(tour);
    const handler = new URIHandler();
    await handler.handleUri(new Uri("vscode", "", "/openTour", new URLSearchParams({ workspace: "/other-root", tour: `.tours/${name}`, step: "1" }).toString()) as never);
    assert.deepEqual(started.at(-1), { tour, step: 0 });
  }
});
