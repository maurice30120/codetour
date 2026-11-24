const fs = require("node:fs");
const path = require("node:path");

// The JavaScript run-log contract has one readable source of truth: the copy
// the Copilot extension loads from .github/extensions/codetour/. The plugin
// ships a second copy under packages/copilot-plugin/ because it is installed
// from that directory alone. This script generates that copy; the unit test
// src/cli/copilotPlugin.test.ts fails when the two files diverge.
//
// Run `node scripts/sync-copilot-run-log.js` after editing the extension copy,
// then `node scripts/embed-copilot-extension.js` and
// `node scripts/embed-copilot-plugin.js` before committing.

const root = path.resolve(__dirname, "..");
const source = path.join(root, ".github", "extensions", "codetour", "run-log.mjs");
const target = path.join(
  root,
  "packages",
  "copilot-plugin",
  "com.github.copilot",
  "lib",
  "run-log.mjs"
);

const content = fs.readFileSync(source, "utf8");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, content);
console.log(
  `Synced ${path.relative(root, source)} -> ${path.relative(root, target)}`
);
