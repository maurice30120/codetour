const fs = require("node:fs");
const path = require("node:path");

// Embeds the Pi package sources under packages/pi-plugin/ into a generated
// TypeScript module so `codetour --install pi` can install the package without
// any dependency on this Git repository. The strings travel with the compiled
// CLI bundle instead of relying on packaged resource files.
//
// The files under packages/pi-plugin/ are the readable source of truth. After
// editing them, run `node scripts/embed-pi-plugin.js` and commit both copies;
// src/cli/piPlugin.test.ts fails when they diverge.

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "packages", "pi-plugin");
const target = path.join(root, "src", "cli", "pi-plugin.generated.ts");

function walk(directory, prefix = "") {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.node_modules || entry.name === "node_modules") continue;
    if (entry.isDirectory()) entries.push(...walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) entries.push(relative);
  }
  return entries;
}

const files = walk(sourceDir);

for (const required of [
  "package.json",
  "extensions/codetour.ts",
  "lib/journal.mjs",
  "lib/reader.mjs",
  "skills/codetour-generate/SKILL.md"
]) {
  if (!files.includes(required)) {
    throw new Error(`The Pi plugin is missing ${required} in ${sourceDir}.`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"));
if (!Array.isArray(manifest.pi?.extensions) || !manifest.pi.extensions.includes("./extensions/codetour.ts")) {
  throw new Error('package.json must declare pi.extensions including "./extensions/codetour.ts".');
}
if (!Array.isArray(manifest.pi?.skills) || !manifest.pi.skills.includes("./skills")) {
  throw new Error('package.json must declare pi.skills including "./skills".');
}
if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
  throw new Error("The Pi package must not declare runtime dependencies: the host provides its peer API.");
}

const banner = [
  "// GENERATED FILE - do not edit by hand.",
  "// Regenerate with `node scripts/embed-pi-plugin.js` after editing",
  "// packages/pi-plugin/. The unit test piPlugin.test.ts fails when this module",
  "// diverges from the package sources.",
  "",
].join("\n");

const entries = files.map(file => {
  const content = fs.readFileSync(path.join(sourceDir, file), "utf8");
  return `  ${JSON.stringify(file)}: ${JSON.stringify(content)}`;
});

fs.writeFileSync(
  target,
  `${banner}export const PI_PLUGIN_FILES: Readonly<Record<string, string>> = {\n${entries.join(",\n")}\n};\n`
);
console.log(`Embedded ${files.length} Pi plugin files into ${path.relative(root, target)}`);
