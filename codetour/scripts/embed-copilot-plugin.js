const fs = require("node:fs");
const path = require("node:path");

// Embeds the Agent Plugins 1.0 sources under packages/copilot-plugin/ into a
// generated TypeScript module so `codetour --install copilot` can install the
// plugin without any dependency on this Git repository. The strings travel
// with the compiled CLI bundle instead of relying on packaged resource files.
//
// The files under packages/copilot-plugin/ are the readable source of truth.
// After editing them, run `node scripts/embed-copilot-plugin.js` and commit
// both copies; src/cli/copilotPlugin.test.ts fails when they diverge.

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "packages", "copilot-plugin");
const target = path.join(root, "src", "cli", "copilot-plugin.generated.ts");

function walk(directory, prefix = "") {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) entries.push(relative);
  }
  return entries;
}

const files = walk(sourceDir);

for (const required of [
  "plugin.json",
  "com.github.copilot/hooks/hooks.json",
  "com.github.copilot/hooks/agent-stop.mjs",
  "com.github.copilot/lib/run-log.mjs",
  "skills/codetour-generate/SKILL.md",
  "skills/codetour-generate/references/anchors.md",
  "skills/codetour-generate/references/mermaid.md",
  "skills/codetour-generate/references/project-tour.md",
  "skills/codetour-generate/references/changes-tour-neutral.md",
  "skills/codetour-generate/references/changes-tour-critical.md",
  "skills/codetour-generate/references/codetour-adaptation.md",
  "skills/codetour-generate/references/upstream-code-review.md",
  "skills/codetour-generate/references/upstream-LICENSE.txt"
]) {
  if (!files.includes(required)) {
    throw new Error(`The Copilot plugin is missing ${required} in ${sourceDir}.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "plugin.json"), "utf8"));
if (manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") {
  throw new Error("plugin.json must declare the Agent Plugins 1.0 $schema.");
}
// The plugin declares no MCP server (ADR 0057): a transport declaration would
// launch a command this release no longer ships.
if (fs.existsSync(path.join(sourceDir, "mcp.json"))) {
  throw new Error("The Copilot plugin must not declare an MCP server: remove mcp.json.");
}

const banner = [
  "// GENERATED FILE - do not edit by hand.",
  "// Regenerate with `node scripts/embed-copilot-plugin.js` after editing",
  "// packages/copilot-plugin/. The unit test copilotPlugin.test.ts fails when",
  "// this module diverges from the plugin sources.",
  "",
].join("\n");

const entries = files.map(file => {
  const content = fs.readFileSync(path.join(sourceDir, file), "utf8");
  return `  ${JSON.stringify(file)}: ${JSON.stringify(content)}`;
});

fs.writeFileSync(
  target,
  `${banner}export const COPILOT_PLUGIN_FILES: Readonly<Record<string, string>> = {\n${entries.join(",\n")}\n};\n`
);
console.log(`Embedded ${files.length} Copilot plugin files into ${path.relative(root, target)}`);
