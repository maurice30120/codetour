import { test } from "node:test";
import * as assert from "node:assert";
import { vibeAcpEntry } from "./vibeAcpEntry";

test("Vibe launches its dedicated ACP executable, never the interactive CLI", () => {
  assert.deepEqual(vibeAcpEntry("/workspace"), {
    command: "vibe-acp", args: [], cwd: "/workspace"
  });
});
