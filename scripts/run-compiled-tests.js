const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const testDirectory = resolve(process.argv[2]);
function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory()
      ? findTestFiles(entryPath)
      : entry.name.endsWith(".test.js")
        ? [entryPath]
        : [];
  });
}

const testFiles = findTestFiles(testDirectory).sort();

if (testFiles.length === 0) {
  console.error(`No compiled test files found in ${testDirectory}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
