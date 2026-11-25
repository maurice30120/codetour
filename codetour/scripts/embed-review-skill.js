const fs = require("node:fs");
const path = require("node:path");

// Copies the critical-review pack into the shipped skill directories.
//
// The pack (the CodeTour adaptation, the verbatim upstream skill and its MIT
// license) is what makes `reviewMode: "critical"` more than a word: both
// generation skills require reading it before they write a critical Changes
// Tour. It no longer travels through a server, so each shipped skill carries its
// own copy next to the SKILL.md that names it.
//
// docs/critical-review/ is the readable source of truth. After editing it, run
// `node scripts/embed-review-skill.js` and commit the copies;
// src/cli/criticalReviewSkill.test.ts fails when a copy diverges.

const root = path.resolve(__dirname, "..");
const sourceDirectory = path.join(root, "docs", "critical-review");
const skillDirectories = [
  path.join(root, "packages", "copilot-plugin", "skills", "codetour-generate"),
  path.join(root, "packages", "pi-plugin", "skills", "codetour-generate")
];

const sources = ["codetour-adaptation.md", "upstream-code-review.md", "upstream-LICENSE.txt"];

for (const name of sources) {
  if (!fs.existsSync(path.join(sourceDirectory, name))) {
    throw new Error(`The critical-review pack is missing ${name} in ${sourceDirectory}.`);
  }
}

for (const skillDirectory of skillDirectories) {
  const target = path.join(skillDirectory, "references");
  fs.mkdirSync(target, { recursive: true });
  for (const name of sources) {
    fs.copyFileSync(path.join(sourceDirectory, name), path.join(target, name));
  }
  console.log(`Copied the critical-review pack into ${path.relative(root, target)}`);
}
