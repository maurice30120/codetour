// Regression: a development extension must expose its prototype in the palette
// of a RELEASE build of VS Code, where VS Code's own isDevelopment is false.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const menu = JSON.parse(fs.readFileSync(path.join(root, "package.json"))).contributes
  .menus.commandPalette.find(item => item.command === "codetour.prototypeWebview");
for (const development of [true, false]) {
  const contexts = new Map([["isDevelopment", false]]);
  const commands = new Map();
  const vscode = {
    ExtensionMode: { Development: 2, Production: 1 },
    commands: {
      registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; },
      executeCommand: async (id, key, value) => { if (id === "setContext") contexts.set(key, value); }
    }
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, "src/player/tourWebview.prototype.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === "vscode" ? vscode : {} });
  module.exports.registerTourWebviewPrototype({ extensionMode: development ? 2 : 1, subscriptions: [] });
  assert.equal(commands.has(menu.command), development);
  assert.equal(contexts.get(menu.when) ?? false, development,
    `Prototype palette visibility must match extension mode (${development ? "development" : "production"})`);
}
console.log("PASS: prototype command visible in a release VS Code development host; hidden in production.");
