import { test } from "node:test";
import * as assert from "node:assert/strict";
import { discoverToursFromRoot, visibleTours } from "./tourDiscovery";

test("discovery skips the memory directory while retaining nested tours", async () => {
  const listed: string[] = [];
  const tours = await discoverToursFromRoot("/workspace", {
    join: (root, relative) => `${root}/${relative}`,
    id: path => path,
    read: async path => {
      if (path === "/workspace/.tours/nested/guide.tour") {
        return JSON.stringify({ title: "Guide", steps: [] });
      }
      throw new Error("missing");
    },
    list: async path => {
      listed.push(path);
      if (path === "/workspace/.tours") return [
        { name: ".memory", isDirectory: true },
        { name: "nested", isDirectory: true }
      ];
      if (path === "/workspace/.tours/nested") return [
        { name: "guide.tour", isDirectory: false }
      ];
      throw new Error("missing");
    }
  });
  assert.deepEqual(visibleTours(tours, { isLinux: false, isMac: true, isWindows: false, isWeb: false }).map(tour => tour.title), ["Guide"]);
  assert.ok(!listed.includes("/workspace/.tours/.memory"));
});
