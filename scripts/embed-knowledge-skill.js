const fs = require("node:fs");
const path = require("node:path");

// Embeds the native Knowledge skill source under
// packages/knowledge/skills/codetour-knowledge/ into a generated TypeScript
// module so `codetour --install copilot` can write
// ~/.copilot/skills/codetour-knowledge/SKILL.md without any dependency on this
// Git repository. The string travels with the compiled CLI bundle instead of
// relying on packaged resource files.
//
// The SKILL.md file is the readable source of truth. After editing it, run
// `node scripts/embed-knowledge-skill.js` and commit both copies; the unit test
// knowledgeSkill.test.ts fails when they diverge.

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "packages", "knowledge", "skills", "codetour-knowledge");
const source = path.join(sourceDir, "SKILL.md");
const target = path.join(root, "src", "cli", "knowledge-skill.generated.ts");

if (!fs.existsSync(source)) {
  throw new Error(`No Knowledge skill source found at ${source}.`);
}

const content = fs.readFileSync(source, "utf8");
if (!content.startsWith("---\nname: codetour-knowledge\n")) {
  throw new Error(`${source} must start with the codetour-knowledge frontmatter.`);
}

const banner = [
  "// GENERATED FILE - do not edit by hand.",
  "// Regenerate with `node scripts/embed-knowledge-skill.js` after editing",
  "// packages/knowledge/skills/codetour-knowledge/SKILL.md. The unit test",
  "// knowledgeSkill.test.ts fails when this module diverges from it.",
  "",
].join("\n");

fs.writeFileSync(
  target,
  `${banner}export const CODETOUR_KNOWLEDGE_SKILL: string = ${JSON.stringify(content)};\n`
);
console.log(`Embedded the Knowledge skill into ${path.relative(root, target)}`);
