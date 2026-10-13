#!/usr/bin/env node
"use strict";
// Real Electron smoke tests. Usage: node scripts/run-vscode-tests.js [--vsix path] [--code executable]
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const executable = value("--code") || process.env.VSCODE_EXECUTABLE || [
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders"
].find(file => fs.existsSync(file));
if (!executable) throw new Error("Set VSCODE_EXECUTABLE to an installed VS Code executable.");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-real-host-"));
const workspace = path.join(temp, "workspace");
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, "anchor.js"), "const first = 1;\nconst second = 2;\nconst third = 3;\n");
const profile = path.join(temp, "profile");
fs.mkdirSync(path.join(profile, "User"), { recursive: true });
fs.writeFileSync(path.join(profile, "User", "settings.json"), JSON.stringify({
  "security.workspace.trust.enabled": false,
  "codetour.promptForWorkspaceTours": false,
  "codetour.playbackMode": "comments",
  "workbench.startupEditor": "none",
  "window.restoreWindows": "none",
  "extensions.autoUpdate": false
}));
const extensions = path.join(temp, "extensions");
fs.mkdirSync(extensions);
let development = root;
const vsix = value("--vsix");
if (vsix) {
  // Extract into isolated extensions directory: guarantees exactly this artifact,
  // without downloading dependencies or mutating the user's extension profile.
  const extract = path.join(temp, "vsix");
  const unpack = spawnSync("unzip", ["-q", path.resolve(vsix), "-d", extract], { encoding: "utf8" });
  if (unpack.status !== 0) throw new Error(unpack.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(extract, "extension", "package.json")));
  development = path.join(extensions, manifest.publisher + "." + manifest.name + "-" + manifest.version);
  fs.renameSync(path.join(extract, "extension"), development);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
  };
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
        setTimeout(() => { if (pending.delete(requestId)) reject(new Error("CDP timeout: " + method)); }, 5000).unref();
      });
    },
    close() { socket.close(); }
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function observe(port, expected) {
  const version = await (await fetch("http://127.0.0.1:" + port + "/json/version")).json();
  const cdp = await connect(version.webSocketDebuggerUrl);
  try {
    const { targetInfos } = await cdp.call("Target.getTargets");
    const found = [];
    for (const target of targetInfos.filter(t => ["page", "iframe", "webview"].includes(t.type))) {
      let sessionId;
      try {
        ({ sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
        const result = await cdp.call("Runtime.evaluate", {
          expression: 'JSON.stringify({step:document.body?.dataset.step, text:document.body?.innerText, buttons:[...document.querySelectorAll("button[data-action]")].map(b=>({action:b.dataset.action,disabled:b.disabled}))})',
          returnByValue: true
        }, sessionId);
        const data = JSON.parse(result.result.value || "{}");
        if (data.step !== undefined) found.push(data);
      } catch (_) { /* Target can disappear while switching modes. */ }
      finally { if (sessionId) await cdp.call("Target.detachFromTarget", { sessionId }).catch(() => {}); }
    }
    if (expected.absent) return { ok: found.length === 0, found };
    const match = found.find(data => data.step === String(expected.step) && data.text.includes(expected.text));
    return { ok: !!match, found };
  } finally { cdp.close(); }
}
(async () => {
  const port = await freePort();
  const log = fs.openSync(path.join(temp, "electron.log"), "w");
  const launchArgs = [
    workspace, "--new-window", "--user-data-dir=" + profile,
    "--extensions-dir=" + extensions, "--extensionTestsPath=" + path.join(root, "test/vscode"),
    "--remote-debugging-port=" + port, "--skip-welcome", "--skip-release-notes",
    "--disable-updates", "--disable-workspace-trust"
  ];
  // Artifact mode is installed normally; only the external smoke-test runner
  // uses extensionTestsPath. Source mode explicitly loads this checkout.
  if (vsix) {
    const companion = path.join(temp, "test-companion");
    fs.mkdirSync(companion);
    fs.writeFileSync(path.join(companion, "package.json"), JSON.stringify({ name: "codetour-host-smoke", publisher: "test", version: "1.0.0", engines: { vscode: "^1.101.0" }, main: "index.js" }));
    fs.writeFileSync(path.join(companion, "index.js"), "exports.activate = () => {}; ");
    launchArgs.push("--extensionDevelopmentPath=" + companion);
  } else launchArgs.push("--extensionDevelopmentPath=" + development);
  const env = { ...process.env, CODETOUR_HOST_TEST_DIR: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, launchArgs, { env, stdio: ["ignore", log, log] });
  let exit;
  child.on("exit", (code, signal) => { exit = { code, signal }; });
  console.log("Real VS Code profile and logs: " + temp);
  const deadline = Date.now() + 120000;
  try {
    while (Date.now() < deadline) {
      const requestFile = path.join(temp, "observe.json");
      if (fs.existsSync(requestFile)) {
        const request = JSON.parse(fs.readFileSync(requestFile));
        let result;
        try { result = await observe(port, request); }
        catch (error) { result = { ok: false, error: String(error) }; }
        if (result.ok || Date.now() > request.deadline) {
          fs.writeFileSync(path.join(temp, "observed-" + request.id + ".json"), JSON.stringify(result));
          fs.unlinkSync(requestFile);
        }
      }
      const report = path.join(temp, "result.json");
      if (fs.existsSync(report)) {
        const result = JSON.parse(fs.readFileSync(report));
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.ok ? 0 : 1;
        return;
      }
      if (exit) throw new Error("VS Code exited before host tests: " + JSON.stringify(exit));
      await pause(200);
    }
    throw new Error("Real VS Code test timed out. Inspect " + path.join(temp, "electron.log"));
  } finally { child.kill(); fs.closeSync(log); }
})().catch(error => { console.error(error); process.exitCode = 1; });
