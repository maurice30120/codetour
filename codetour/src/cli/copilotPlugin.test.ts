import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";

const root = path.resolve(__dirname, "../../..");
const pluginSource = path.join(root, "packages", "copilot-plugin");

function source(relative: string): string {
  return readFileSync(path.join(pluginSource, ...relative.split("/")), "utf8");
}

test("the embedded Copilot plugin matches the versioned Agent Plugins sources", () => {
  for (const [name, content] of Object.entries(COPILOT_PLUGIN_FILES)) {
    assert.equal(
      source(name),
      content,
      `${name} in the bundle diverges from packages/copilot-plugin; run node scripts/embed-copilot-plugin.js`
    );
  }
});

test("the plugin manifest declares Agent Plugins 1.0 and only allowed fields", () => {
  const manifest = JSON.parse(source("plugin.json"));
  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "codetour");
  assert.match(manifest.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  for (const key of Object.keys(manifest)) {
    assert.ok(
      ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"].includes(key),
      `${key} is not an Agent Plugins 1.0 manifest field`
    );
  }
});

test("the plugin manifest advertises the CLI generation, not a server transport", () => {
  const manifest = JSON.parse(source("plugin.json"));
  assert.doesNotMatch(manifest.description, /\bmcp\b/i);
  assert.match(manifest.description, /CodeTour CLI/);
  assert.deepEqual(manifest.keywords, ["codetour", "tours", "copilot"]);
});

test("the plugin hook is deterministic, bounded and reads the host payload", () => {
  const hooks = JSON.parse(source("com.github.copilot/hooks/hooks.json"));
  assert.equal(hooks.version, 1);
  assert.equal(hooks.hooks.agentStop.length, 1);
  assert.equal(hooks.hooks.agentStop[0].type, "command");
  assert.match(hooks.hooks.agentStop[0].command, /\$\{PLUGIN_ROOT\}\/com\.github\.copilot\/hooks\/agent-stop\.mjs/);
  assert.ok(hooks.hooks.agentStop[0].timeoutSec > 0 && hooks.hooks.agentStop[0].timeoutSec <= 60);

  const hook = source("com.github.copilot/hooks/agent-stop.mjs");
  assert.doesNotMatch(hook, /fetch\(|https?:|openai|anthropic|chat\.completions/i, "the hook must not call a model or the network");
  assert.doesNotMatch(hook, /knowledgeDirectory|\.memory\/knowledge|saveKnowledgeProposal/i, "the hook must not write Knowledge");
  assert.doesNotMatch(hook, /decision\s*:\s*"block"|"decision"/, "the hook never asks for a continuation");
  assert.match(hook, /stop_hook_active/, "a hook-triggered re-entry is honored");
  // The response is attributed from the host payload plus the two observability
  // documents, never from the run state the retired guard read.
  assert.match(hook, /input\.sessionId/);
  assert.match(hook, /input\.timestamp/);
  assert.match(hook, /input\.cwd/);
  assert.match(hook, /input\.transcriptPath/);
  assert.doesNotMatch(hook, /codetour-run-|runState|continuationUsed/i);
  assert.match(hook, /process\.stderr\.write/, "the summary goes to the human channel, never to the hook protocol");
});

test("the plugin skill carries the CLI creation workflow and names no server surface", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /^---\nname: codetour-generate\n/);
  assert.match(skill, /user-invocable: true/);
  // The workflow is the CLI: explicit workspace, proposal on stdin, one JSON
  // document back, exit codes, issues to fix.
  assert.match(skill, /codetour create-project-tour --workspace/);
  assert.match(skill, /codetour create-changes-tour --workspace/);
  assert.match(skill, /standard input/);
  assert.match(skill, /exactly one JSON document/);
  assert.match(skill, /`0` \| the Tour was created/);
  assert.match(skill, /`1` \| the proposal, its validation or the creation was refused/);
  assert.match(skill, /`2` \| usage or IO failure/);
  assert.match(skill, /`issues`/);
  assert.match(skill, /reviewMode/);
  assert.match(skill, /critical/);
  assert.match(skill, /orientation/i);
  assert.match(skill, /language/i);
  // No server surface may be named: no tool, no prompt, no server command.
  assert.doesNotMatch(skill, /\bmcp\b/i);
  assert.doesNotMatch(skill, /prompts\/get|get_generation_prompt|codetour_prepare_generation/);
  assert.doesNotMatch(skill, /create_project_tour|create_changes_tour/);
  assert.doesNotMatch(skill, /copilot mcp list/);
  assert.doesNotMatch(skill, /knowledge_save|knowledge_close_run/);
});

test("the plugin skill keeps the reader hand-over rules", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /codetour "<Tour title>"/);
  assert.match(skill, /codetour --internal-tour "<tour path>"/);
  assert.match(skill, /codetour --internal-open-vscode "<tour path>"/);
  assert.match(skill, /never replace the created Tour with a step list/i);
});

test("the hook reads its journal and usage helpers from the plugin library", () => {
  const hook = source("com.github.copilot/hooks/agent-stop.mjs");
  assert.match(hook, /from "\.\.\/lib\/run-log\.mjs"/);
  const library = source("com.github.copilot/lib/run-log.mjs");
  for (const helper of [
    "creationsDirectory",
    "reportedDirectory",
    "isCreationRecord",
    "listCreations",
    "readResponseWindow",
    "summarizeUsage",
    "isReported",
    "markReported"
  ]) {
    assert.match(library, new RegExp(`export (?:async )?function ${helper}\\b`), `${helper} is exported`);
  }
  // The run-state contract this ticket stops using is gone from the plugin: no
  // reader or writer of `codetour-run-*.json` remains here.
  assert.doesNotMatch(library, /createRunState|listRunStates|recordRunMetrics|RUN_FILE_PREFIX/);
  // The plugin copy is hand-written now; the extension's copy no longer feeds
  // it, so the byte-for-byte sync script is gone with the contract.
  assert.equal(
    existsSync(path.join(root, "scripts", "sync-copilot-run-log.js")),
    false,
    "the plugin library is no longer generated from the Copilot extension copy"
  );
});

test("the installed plugin totals exactly the declared components", () => {
  assert.deepEqual(
    Object.keys(COPILOT_PLUGIN_FILES).sort(),
    [
      "README.md",
      "com.github.copilot/hooks/agent-stop.mjs",
      "com.github.copilot/hooks/hooks.json",
      "com.github.copilot/lib/run-log.mjs",
      "mcp.json",
      "plugin.json",
      "skills/codetour-generate/SKILL.md"
    ]
  );
});
