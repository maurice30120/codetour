// Exercises the real prototype command and HTML renderer with an in-memory
// VS Code surface. Description rendering is stubbed; layout construction isn't.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { observable } = require("mobx");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
function load(file, overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports,
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name) });
  return module.exports;
}
async function run() {
  const tour = observable(JSON.parse(fs.readFileSync(path.join(root, ".tours/changes.tour"), "utf8")));
  assert.ok(tour.steps.length > 1, "The regression requires multiple steps");
  const commands = new Map();
  let onMessage;
  const panel = { webview: { html: "", onDidReceiveMessage: handler => { onMessage = handler; } },
    onDidDispose() {}, dispose() {} };
  const vscode = { ExtensionMode: { Development: 2 }, ViewColumn: { One: 1, Beside: -2 },
    Position: class {}, Range: class {},
    commands: { registerCommand: (id, handler) => { commands.set(id, handler); return {}; }, executeCommand: async () => {} },
    window: { showQuickPick: async items => items[0], createWebviewPanel: () => panel,
      showTextDocument: async () => {}, showWarningMessage: text => { throw new Error(text); } } };
  const markdown = load("src/player/markdown.ts");
  const prototype = load("src/player/tourWebview.prototype.ts", {
    vscode, "../store": { store: { tours: [tour] } },
    "../utils": { getWorkspaceUri() {}, getStepFileUri: async () => "file" },
    "./description": { renderPreviewDescription: async text => text },
    "./diff": { getStepDiff: async () => undefined }, "./markdown": markdown
  });
  prototype.registerTourWebviewPrototype({ extensionMode: 2, subscriptions: [] });
  await commands.get("codetour.prototypeWebview")();
  function check(variant, count, index = 0) {
    const messages = [];
    const dom = new JSDOM(panel.webview.html, { runScripts: "dangerously",
      beforeParse(window) { window.acquireVsCodeApi = () => ({ postMessage: message => messages.push(message) }); } });
    assert.equal(dom.window.document.querySelectorAll("article").length, count);
    assert.ok(dom.window.document.querySelector(".switcher").textContent.includes(variant));
    assert.ok(dom.window.document.querySelector("article").textContent.includes(tour.steps[variant === "C" ? 0 : index].title));
    dom.window.document.querySelector('[data-variant="1"]').click();
    assert.equal(messages.at(-1).type, "variant");
    assert.equal(messages.at(-1).variant, { A: "B", B: "C", C: "A" }[variant]);
    dom.window.document.querySelector('[data-action="code"]').click();
    assert.equal(messages.at(-1).type, "code");
    dom.window.close();
  }
  check("A", 1);
  await onMessage({ type: "variant", variant: "B" }); check("B", 1);
  await onMessage({ type: "variant", variant: "C" }); check("C", tour.steps.length);
  await onMessage({ type: "variant", variant: "A" }); check("A", 1);
  await onMessage({ type: "step", index: 1 });
  check("A", 1, 1);
  console.log(`PASS: command renders A/B/C and navigates the ${tour.steps.length}-step tour without invalid Markdown input.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
