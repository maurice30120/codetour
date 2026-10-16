import { test } from "node:test";
import * as assert from "node:assert";
import { acpProviders } from "./acpProviders";

test("ACP providers use the requested priority and workspace", () => {
  const providers = acpProviders("/workspace");
  assert.deepEqual(providers.map(provider => provider.name), ["Vibe", "Copilot", "Codex", "Claude Code"]);
  assert.deepEqual(providers.map(provider => provider.entry.command), ["vibe-acp", "copilot", "codex-acp", "claude-agent-acp"]);
  assert.ok(providers.every(provider => provider.entry.cwd === "/workspace"));
  assert.ok(providers[1].entry.args?.includes("--available-tools=view,grep,glob"));
  assert.equal(providers[1].entry.modeId, undefined);
  assert.equal(providers[1].entry.useDefaultMode, true);
  assert.equal(providers[2].entry.modeId, "read-only");
  assert.equal(providers[3].entry.modeId, "plan");
});
