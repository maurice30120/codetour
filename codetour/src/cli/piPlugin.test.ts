import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";
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
    "lib/journal.mjs",
    "lib/reader.mjs",
    "skills/codetour-generate/SKILL.md",
    "skills/codetour-generate/references/anchors.md",
    "skills/codetour-generate/references/mermaid.md",
    "skills/codetour-generate/references/project-tour.md",
    "skills/codetour-generate/references/changes-tour-neutral.md",
    "skills/codetour-generate/references/changes-tour-critical.md",
  ]) {
    assert.ok(PI_PLUGIN_FILES[required], `${required} is missing from the embedded package`);
  }
});

test("both plugins ship the same reference files", () => {
  const referencesOf = (files: Record<string, string>) =>
    Object.keys(files).filter(entry => entry.startsWith("skills/codetour-generate/references/"));
  const shipped = referencesOf(PI_PLUGIN_FILES);
  // The shared rules live once: a reference module that drifts between the two
  // hosts would teach two generations of the same Tour. The union of both
  // bundles is compared in both directions, so a reference added to one host
  // alone cannot go unnoticed.
  for (const module of [
    "anchors",
    "mermaid",
    "project-tour",
    "changes-tour-neutral",
    "changes-tour-critical",
  ]) {
    assert.ok(
      shipped.includes(`skills/codetour-generate/references/${module}.md`),
      `${module}.md is shipped beside the skill`
    );
  }
  assert.deepEqual(
    [...referencesOf(COPILOT_PLUGIN_FILES)].sort(),
    [...shipped].sort(),
    "both hosts ship exactly the same references"
  );
  for (const reference of shipped) {
    const pi = source(reference);
    const copilot = readFileSync(path.join(root, "packages", "copilot-plugin", reference), "utf8");
    assert.equal(pi, copilot, `${reference} diverges between the two plugins`);
    // A module lives in `references/`, so its own siblings are bare names and
    // the skill is one directory up: `references/references/` resolves to
    // nothing an agent can open.
    assert.doesNotMatch(pi, /references\/references\//, `${reference} resolves a sibling from itself`);
  }
});

test("the Pi manifest declares its resources and no runtime dependency", () => {
  const manifest = JSON.parse(source("package.json"));
  assert.equal(manifest.name, "codetour-pi-plugin");
  assert.deepEqual(manifest.pi.extensions, ["./extensions/codetour.ts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.deepEqual(manifest.peerDependencies, { "@earendil-works/pi-coding-agent": "*" });
  assert.equal(manifest.dependencies, undefined);
  // The package no longer advertises a server it does not use.
  assert.equal(manifest.keywords.includes("mcp"), false);
  assert.doesNotMatch(manifest.description, /MCP/);
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

test("the extension registers no MCP server and never generates a Tour itself", () => {
  const extension = source("extensions/codetour.ts");
  assert.doesNotMatch(extension, /registerMcpServer|unregisterMcpServer|getAllTools/);
  assert.doesNotMatch(extension, /mcp__codetour__|--workspace-root|exposure: "deferred"/);
  // The Tour method lives in the skill and the rules in the CLI; the extension
  // must not write Tours, call the network or spawn the creation itself.
  assert.doesNotMatch(extension, /\.tour["'`]?\s*,\s*JSON\.stringify|writeFile\([^)]*\.tour/);
  assert.doesNotMatch(extension, /fetch\(|https?:\/\//, "the extension must not call the network");
  assert.doesNotMatch(extension, /saveKnowledgeProposal/);
});

test("the end-of-response report reads the creation journal and never continues", () => {
  const extension = source("extensions/codetour.ts");
  for (const name of ["readCreations", "selectCreated", "summaryLines", "tokenLine"]) {
    assert.ok(extension.includes(name), `the report must consume lib/journal.mjs (${name})`);
  }
  // `agent_settled` is Pi's final, notification-only boundary: it cannot ask
  // for a continuation, and the actionable settle event is not handled.
  assert.match(extension, /pi\.on\("agent_start"/);
  assert.match(extension, /pi\.on\("agent_end"/);
  assert.match(extension, /pi\.on\("agent_settled"/);
  assert.doesNotMatch(extension, /agent_before_settle/);
  assert.doesNotMatch(extension, /continue:\s*true/);
  // The MCP-era run-state machinery is gone.
  assert.doesNotMatch(extension, /run-log|RunState|guard\.mjs|continuationMessage/);
});

test("the closing offer opens the real reader or asks for VS Code; the spawn lives in lib/reader.mjs", () => {
  const extension = source("extensions/codetour.ts");
  // The end of response asks the user: the real interactive reader of the
  // created Tour — spawned immediately, in the same terminal — or the Tour at
  // its active step in VS Code. The decision logic AND the reader spawn live in
  // the lib/reader.mjs module; the extension only asks and debouches.
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

test("the skill creates the Tour with the CLI and names no MCP tool", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /^---\nname: codetour-generate\ndescription: .+\n---\n/);
  assert.doesNotMatch(skill, /mcp__|MCP/);
  // The creation surface of DESIGN §2, with the explicit workspace.
  assert.match(skill, /create-project-tour --workspace/);
  assert.match(skill, /create-changes-tour --workspace/);
  assert.match(skill, /--proposal/);
  // The skill never writes a Tour file itself.
  assert.doesNotMatch(skill, /\.tour\s*["'`]?\s*,\s*JSON\.stringify|writeFile/);
  assert.match(skill, /Exit `0`/);
  assert.match(skill, /Exit `1`/);
  assert.match(skill, /Exit `2`/);
  assert.match(skill, /issues/);
  assert.doesNotMatch(skill, /ask_user/);
});

test("the skill carries the kind, the review mode, the orientation and the workspace choice", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  // Both kinds and both review modes, in the user's language.
  assert.match(skill, /type=project\|changes/);
  assert.match(skill, /reviewMode=neutral\|critical/);
  assert.match(skill, /neutral.*critical/is);
  // Orientation and language are user-facing decisions, not silent defaults.
  assert.match(skill, /Orientation/);
  assert.match(skill, /Language/);
  assert.match(skill, /user's language/);
  // The workspace is chosen at generation time and always explicit.
  assert.match(skill, /Workspace/);
  assert.match(skill, /--workspace <dir>/);
  // The CLI travels with the skill, with the documented PATH fallback.
  assert.match(skill, /codetour-cli/);
  assert.match(skill, /PATH/);
  assert.match(skill, /codetour --install pi/);
});

test("the skill ends the generation with the two real openings, never a summary", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  // The real interactive reader: the default reading path and the direct
  // Tour-file path, run at the workspace root.
  assert.match(skill, /codetour "<Tour title>"/);
  assert.match(skill, /codetour --internal-tour/);
  // The Open-in-VS Code contract: the CLI's opening command, the only spelling
  // of the opening (single seam).
  assert.match(skill, /--internal-open-vscode/);
  assert.doesNotMatch(skill, /code --open-url/);
  // No textual summary answers for the reader, whatever the choice.
  assert.match(skill, /never replace the Tour with a step list/i);
});

test("the skill routes each generation path to one module, read before exploring", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  // One public skill and three modules: the type and the review mode name the
  // module, and the module is read before exploration starts.
  for (const module of ["project-tour", "changes-tour-neutral", "changes-tour-critical"]) {
    assert.match(skill, new RegExp(`references/${module}\\.md`), `${module} is routed`);
  }
  // The routing instruction itself: "before exploring" occurs elsewhere in the
  // skill, so the sentence that names the module to read before exploring is
  // what has to stay.
  assert.match(
    skill,
    /state the module\s+path you selected, then read that module \*\*before exploring\*\*/
  );
  // The shared rules stay in the one skill the agent always loads.
  for (const shared of ["Orientation", "Language", "Workspace", "Mermaid", "Anchors"]) {
    assert.match(skill, new RegExp(shared), `${shared} stays in the public skill`);
  }
});

test("each module carries its path down to the CLI invocation", () => {
  const module = (name: string) => source(`skills/codetour-generate/references/${name}.md`);

  const project = module("project-tour");
  assert.match(project, /create-project-tour --workspace <dir> --proposal -/);
  assert.doesNotMatch(project, /create-changes-tour|baseRef|headRef/);

  const neutral = module("changes-tour-neutral");
  assert.match(neutral, /create-changes-tour --workspace <dir> --proposal -/);
  assert.match(neutral, /baseRef/);
  assert.match(neutral, /headRef/);
  assert.match(neutral, /merge-base/);
  assert.match(neutral, /"reviewMode": "neutral"/);

  const critical = module("changes-tour-critical");
  assert.match(critical, /create-changes-tour --workspace <dir> --proposal -/);
  assert.match(critical, /baseRef/);
  assert.match(critical, /headRef/);
  assert.match(critical, /"reviewMode": "critical"/);
});

test("the skill documents the mandatory refs of every Changes Tour", () => {
  const skill = source("skills/codetour-generate/SKILL.md");
  assert.match(skill, /`baseRef` and `headRef` are mandatory for every Changes Tour/);
  assert.match(skill, /full 40-character SHA/);
  // A Changes Tour is the shared document plus exactly these fields: the
  // module of its path shows the complete document.
  assert.match(skill, /`includeUncommittedChanges`/);
});
