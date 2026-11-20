import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { PI_PLUGIN_FILES } from "./pi-plugin.generated";

const root = path.resolve(__dirname, "../../..");
const pluginSource = path.join(root, "packages", "pi-plugin");

function source(relative: string): string {
  return readFileSync(path.join(pluginSource, ...relative.split("/")), "utf8");
}

test("the embedded Pi package matches the versioned sources", () => {
  for (const [name, content] of Object.entries(PI_PLUGIN_FILES)) {
    assert.equal(
      source(name),
      content,
      `${name} in the bundle diverges from packages/pi-plugin; run node scripts/embed-pi-plugin.js`
    );
  }
  for (const required of [
    "package.json",
    "extensions/codetour.ts",
    "lib/guard.mjs",
    "lib/run-log.mjs",
    "skills/codetour-generate/SKILL.md",
  ]) {
    assert.ok(PI_PLUGIN_FILES[required], `${required} is missing from the embedded package`);
  }
});

test("the Pi manifest declares its resources and no runtime dependency", () => {
  const manifest = JSON.parse(source("package.json"));
  assert.equal(manifest.name, "codetour-pi-plugin");
  assert.deepEqual(manifest.pi.extensions, ["./extensions/codetour.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.deepEqual(manifest.peerDependencies, { "@earendil-works/pi-coding-agent": "*" });
  assert.equal(manifest.dependencies, undefined);
  for (const host of [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-tui",
    "typebox",
  ]) {
    assert.equal(
      manifest.dependencies?.[host],
      undefined,
      `${host} must stay a peer dependency: the host provides it`
    );
  }
});

test("the extension declares one MCP server and never generates a Tour itself", () => {
  const extension = source("extensions/codetour.ts");
  assert.match(extension, /registerMcpServer\(SERVER_NAME/);
  assert.match(extension, /const SERVER_NAME = "codetour"/);
  assert.match(extension, /"--workspace-root"/);
  assert.match(extension, /exposure: "deferred"/);
  // The Tour method lives in the served MCP prompt; the extension must not
  // write Tours or Knowledge, and must not carry a fallback prompt.
  assert.doesNotMatch(extension, /\.tour["'`]?\s*,\s*JSON\.stringify|writeFile\([^)]*\.tour/);
  assert.doesNotMatch(extension, /fetch\(|https?:\/\//, "the extension must not call the network");
  assert.doesNotMatch(extension, /saveKnowledgeProposal/);
});

test("the guard is bounded: one continuation, marked under the run-state lock", () => {
  const extension = source("extensions/codetour.ts");
  assert.match(extension, /pi\.on\("agent_before_settle"/);
  assert.match(extension, /continue: true/);
  assert.match(extension, /continuationUsed/);
  assert.match(extension, /selectContinuation\(/);
  const guard = source("lib/guard.mjs");
  assert.match(guard, /state\.continuationUsed !== true/);
  assert.match(guard, /isClosed\(state\)/);
  assert.doesNotMatch(guard, /fetch\(|https?:\/\//);
});

test("the skill defers to the served prompt and names the Pi tool prefix", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /^---\nname: codetour-generate\ndescription: .+\n---\n/);
  for (const tool of [
    "mcp__codetour__get_generation_prompt",
    "mcp__codetour__create_project_tour",
    "mcp__codetour__create_changes_tour",
    "mcp__codetour__knowledge_save",
    "mcp__codetour__knowledge_close_run",
  ]) {
    assert.ok(skill.includes(tool), `the skill must name ${tool}`);
  }
  assert.match(skill, /codetour --install pi/);
  assert.doesNotMatch(skill, /ask_user/);
  // The skill boots a generation; it never restates the Tour method.
  assert.doesNotMatch(skill, /Mermaid|anchor pattern|decomposition step/i);
});
