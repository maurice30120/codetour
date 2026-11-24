import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

const host = createVscodeHost();
const moduleLoader = nodeModule as unknown as { _load: (...args: any[]) => any };
const originalLoad = moduleLoader._load;
moduleLoader._load = function(request: string, ...args: unknown[]) {
  return request === "vscode" ? host.vscode : originalLoad.apply(this, [request, ...args]);
};
const { store } = require("./index");
const storage = require("./storage");

test("revisiting a completed step keeps one progress record per Tour", async () => {
  const tour = { id: "file:///workspace/.tours/progress.tour", title: "Progress", steps: [
    { description: "First" }, { description: "Second" }
  ] };
  storage.initializeStorage(host.extensionContext);
  store.activeTour = { tour, step: 0, thread: null };
  await storage.progress.update();
  await storage.progress.update();
  store.activeTour.step = 1;
  await storage.progress.update();

  const saved = host.extensionContext.globalState.get("codetour:progress");
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [[tour.id, [0, 1]]]);
  assert.equal(storage.progress.isComplete(tour), true);
});
