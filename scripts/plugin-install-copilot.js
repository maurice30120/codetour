const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Rebuilds the CLI bundle (the Copilot adapter travels inside it) and
// reinstalls the extension into ~/.copilot/extensions/codetour/. Run this
// after any change to .github/extensions/codetour/ to test it in a real
// Copilot session; Copilot must be restarted to reload the extension.
//
// Usage: node scripts/plugin-install-copilot.js [--fast]
//   --fast skips the sub-package builds and only rebundles dist/cli.js
//   (webpack), which is enough when only adapter sources changed.

const root = path.resolve(__dirname, "..");
const fast = process.argv.includes("--fast");

const steps = fast
  ? [{title: "webpack bundle", command: "npm", args: ["exec", "--", "webpack", "--mode", "production"]}]
  : [{title: "build", command: "npm", args: ["run", "--silent", "build"]}];

steps.push({
  title: "install copilot extension",
  command: process.execPath,
  args: [path.join(root, "dist", "cli.js"), "--install", "copilot"]
});

for (const step of steps) {
  console.log(`> ${step.command} ${step.args.join(" ")}`);
  const result = spawnSync(step.command, step.args, {cwd: root, stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`plugin-install-copilot: ${step.title} failed (${result.status}).`);
    process.exit(result.status);
  }
}

console.log("Copilot: restart `copilot --experimental` to load the new adapter.");
