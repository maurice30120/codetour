// THROWAWAY: launch the VS Code development host for the WebView experiment.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const result = spawnSync("code", ["--new-window", `--extensionDevelopmentPath=${root}`,
  `--user-data-dir=${path.join(root, ".vscode-test", "user-data")}`,
  `--extensions-dir=${path.join(root, ".vscode-test", "extensions")}`, root], { stdio: "inherit" });
if (result.error) console.error("Ouvrir le projet dans VS Code puis F5 (Test Extension).", result.error.message);
process.exit(result.status ?? 1);
