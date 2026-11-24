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
  assert.match(extension, /unregisterMcpServer\(SERVER_NAME\)/);
  // Registration must happen only in the explicit /codetour flow, never
  // at session startup. The guard releases the server when the run settles.
  const startup = extension.slice(
    extension.indexOf('pi.on("session_start"'),
    extension.indexOf('pi.on("agent_before_settle"')
  );
  assert.doesNotMatch(startup, /registerMcpServer\(/);
  const command = extension.slice(extension.indexOf('pi.registerCommand("codetour"'));
  assert.match(command, /connectMcp\(workspace\)/);
  assert.match(extension, /releaseMcp\(\)/);
  // The Tour method lives in the served MCP prompt; the extension must not
  // write Tours or Knowledge, and must not carry a fallback prompt.
  assert.doesNotMatch(extension, /\.tour["'`]?\s*,\s*JSON\.stringify|writeFile\([^)]*\.tour/);
  assert.doesNotMatch(extension, /fetch\(|https?:\/\//, "the extension must not call the network");
  assert.doesNotMatch(extension, /saveKnowledgeProposal/);
});

test("the closing offer opens the real reader or asks for VS Code; the spawn lives in lib/reader.mjs", () => {
  const extension = source("extensions/codetour.ts");
  // The end of generation asks the user (ticket #242): the real interactive
  // reader of the created Tour — spawned immediately, in the same terminal
  // (review F2) — or the Tour at its active step in VS Code (compressed
  // through the explicit uri contract, ticket #244). The decision logic AND
  // the reader spawn live in the lib/reader.mjs module; the extension only
  // asks and debouches the outcome.
  for (const word of ["openingOptions", "openingQuestion", "playInTerminal", "vscodeCommand"]) {
    assert.ok(extension.includes(word), `the extension must consume lib/reader.mjs (${word})`);
  }
  assert.doesNotMatch(
    extension,
    /child_process|spawn\(/,
    "the extension must not spawn the reader itself"
  );
  const reader = source("lib/reader.mjs");
  assert.match(reader, /codetour --internal-tour/);
  assert.match(reader, /--internal-open-vscode/);
  // The URI construction stays single-seam in the CLI's Open-in-VS Code
  // contract; the package duplicates neither the URI nor the plan.
  assert.doesNotMatch(reader, /vscode:\/\//);
});

test("the settle handler releases the connection without a continuation", () => {
  const extension = source("extensions/codetour.ts");
  assert.match(extension, /pi\.on\("agent_before_settle"/);
  assert.doesNotMatch(extension, /continue: true/);
});

test("the skill defers to the served prompt and names the Pi tool prefix", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /^---\nname: codetour-generate\ndescription: .+\n---\n/);
  for (const tool of [
    "mcp__codetour__get_generation_prompt",
    "mcp__codetour__create_project_tour",
    "mcp__codetour__create_changes_tour",
  ]) {
    assert.ok(skill.includes(tool), `the skill must name ${tool}`);
  }
  assert.match(skill, /codetour --install pi/);
  assert.doesNotMatch(skill, /ask_user/);
  // The skill boots a generation; it never restates the Tour method.
  assert.doesNotMatch(skill, /Mermaid|anchor pattern|decomposition step/i);
});

test("the skill ends the generation with the two real openings, never a summary", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  // The real interactive reader (ticket #241): the default reading path and
  // the direct Tour-file path, run at the workspace root.
  assert.match(skill, /codetour "<Tour title>"/);
  assert.match(skill, /codetour --internal-tour/);
  // The Open-in-VS Code contract (ticket #244): the CLI's opening command,
  // the only spelling of the opening (single seam).
  assert.match(skill, /--internal-open-vscode/);
  assert.doesNotMatch(skill, /code --open-url/);
  // No textual summary answers for the reader, whatever the choice.
  assert.match(skill, /never replace the\s+Tour with a step list/i);
});
