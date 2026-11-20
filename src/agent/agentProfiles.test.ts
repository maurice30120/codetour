import { test } from "node:test";
import * as assert from "node:assert";
import { agentProfiles } from "./agentProfiles";

test("ACP agent profiles use the requested priority and workspace", () => {
  const profiles = agentProfiles("/workspace");
  assert.deepEqual(profiles.map(profile => profile.name), ["Vibe", "Copilot", "Codex", "Claude Code"]);
  assert.deepEqual(profiles.map(profile => profile.entry.command), ["vibe-acp", "copilot", "codex-acp", "claude-agent-acp"]);
  assert.ok(profiles.every(profile => profile.entry.cwd === "/workspace"));
  assert.ok(profiles[1].entry.args?.includes("--available-tools=view,grep,glob"));
  assert.equal(profiles[1].entry.modeId, undefined);
  assert.equal(profiles[1].entry.useDefaultMode, true);
  assert.equal(profiles[2].entry.modeId, "read-only");
  assert.equal(profiles[3].entry.modeId, "plan");
});
