const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync, rmSync } = require("node:fs");
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

// tsc does not remove compiled tests whose sources were deleted, and stale
// artifacts would fail against the current sources. Drop them before running.
// Sources mirror dist/test under src/ in the root package and live in test/
// in the subpackages, so both layouts are checked.
const packageRoot = resolve(testDirectory, "..", "..");
for (const testFile of findTestFiles(testDirectory)) {
  const relativeTest = testFile.slice(testDirectory.length + 1).replace(/\.js$/, "");
  const sourceExists = ["src", "test"].some(sourceDirectory =>
    [".ts", ".tsx", ".mts"].some(extension =>
      existsSync(join(packageRoot, sourceDirectory, relativeTest + extension)))
  );
  if (!sourceExists) {
    console.warn(`Skipping compiled test without source: ${relativeTest}`);
    rmSync(testFile, { force: true });
    rmSync(testFile + ".map", { force: true });
  }
}

const testFiles = findTestFiles(testDirectory).sort();

if (testFiles.length === 0) {
  console.error(`No compiled test files found in ${testDirectory}`);
  process.exit(1);
}

// Some integration tests package the MCP server, whose prepack hook refreshes
// its staged renderer. Run test files serially so that refresh cannot race
// with another test process loading the staged package.
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
