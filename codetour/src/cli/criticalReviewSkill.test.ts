import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "path";
import { COPILOT_PLUGIN_FILES } from "./copilot-plugin.generated";
import { PI_PLUGIN_FILES } from "./pi-plugin.generated";

// The critical-review pack is what makes `reviewMode: "critical"` a method and
// not a word (spec #320, DESIGN §12). Both shipped skills carry it beside their
// SKILL.md, because no server serves it any more.

const repository = path.resolve(__dirname, "../../..");
const sourceDirectory = path.join(repository, "docs", "critical-review");
const skills = [
  {
    name: "Copilot",
    directory: path.join(repository, "packages", "copilot-plugin", "skills", "codetour-generate"),
    files: COPILOT_PLUGIN_FILES
  },
  {
    name: "Pi",
    directory: path.join(repository, "packages", "pi-plugin", "skills", "codetour-generate"),
    files: PI_PLUGIN_FILES
  }
];

const pack = ["codetour-adaptation.md", "upstream-code-review.md", "upstream-LICENSE.txt"];

for (const skill of skills) {
  test(`the ${skill.name} skill ships a byte-identical critical-review pack`, () => {
    for (const name of pack) {
      const source = readFileSync(path.join(sourceDirectory, name), "utf8");
      const copy = path.join(skill.directory, "references", name);
      assert.ok(existsSync(copy), `${name} beside the skill`);
      assert.equal(
        readFileSync(copy, "utf8"),
        source,
        `${name} diverges from docs/critical-review; run node scripts/embed-review-skill.js`
      );
    }
  });

  test(`the ${skill.name} skill requires reading the pack and keeps the license`, () => {
    const content = readFileSync(path.join(skill.directory, "SKILL.md"), "utf8");
    assert.match(content, /references\/codetour-adaptation\.md/);
    assert.match(content, /references\/upstream-code-review\.md/);
    // The license stays verbatim: the pack carries vendored MIT text.
    const license = readFileSync(path.join(skill.directory, "references", "upstream-LICENSE.txt"), "utf8");
    assert.match(license, /MIT/);
    assert.match(license, /Matt Pocock/);
  });

  test(`the ${skill.name} plugin embeds the pack, so it installs offline`, () => {
    for (const name of pack) {
      const embedded = skill.files[`skills/codetour-generate/references/${name}`];
      assert.ok(embedded, `${name} is embedded in the generated plugin mirror`);
      assert.equal(embedded, readFileSync(path.join(sourceDirectory, name), "utf8"));
    }
  });
}

test("the pack keeps its provenance verbatim", () => {
  const upstream = readFileSync(path.join(sourceDirectory, "upstream-code-review.md"), "utf8");
  assert.match(upstream, /^---\nname: code-review/m);
  const adaptation = readFileSync(path.join(sourceDirectory, "codetour-adaptation.md"), "utf8");
  assert.match(adaptation, /\*\*Standards:\*\*/);
  assert.match(adaptation, /\*\*Spec:\*\*/);
});
