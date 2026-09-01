const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const testDirectory = resolve(process.argv[2]);
const testFiles = readdirSync(testDirectory, { recursive: true })
  .filter(file => file.endsWith(".test.js"))
  .map(file => join(testDirectory, file))
  .sort();

if (testFiles.length === 0) {
  console.error(`No compiled test files found in ${testDirectory}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
