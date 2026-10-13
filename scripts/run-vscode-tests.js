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

function git(...args) {
  const result = spawnSync("rtk", ["git", "-C", workspace, ...args], {encoding:"utf8"});
  if (result.status !== 0) throw new Error("Fixture Git command failed: " + result.stderr + result.stdout);
  return result.stdout.trim();
}
git("init", "-b", "main");
fs.writeFileSync(path.join(workspace, "diff.js"), "const unchanged = 1;\nconst revised = 1;\n");
git("add", "diff.js");
git("-c", "user.name=CodeTour Smoke", "-c", "user.email=codetour-smoke@example.invalid", "commit", "-m", "base fixture");
const baseRef = git("rev-parse", "HEAD");
fs.writeFileSync(path.join(workspace, "diff.js"), "const unchanged = 1;\nconst revised = 2;\n");
git("add", "diff.js");
git("-c", "user.name=CodeTour Smoke", "-c", "user.email=codetour-smoke@example.invalid", "commit", "-m", "head fixture");
const headRef = git("rev-parse", "HEAD");
fs.writeFileSync(path.join(temp, "git-fixture.json"), JSON.stringify({baseRef,headRef}));

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
  const contexts = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.executionContextCreated") {
      const list = contexts.get(message.sessionId) || [];
      list.push(message.params.context.id);
      contexts.set(message.sessionId, list);
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
  };
  return {
    contexts,
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
    if (expected.width) {
      const workbench = targetInfos.find(t => t.type === "page" && t.url.startsWith("vscode-file:"));
      if (!workbench) return { ok: false, error: "Workbench page missing" };
      const { windowId } = await cdp.call("Browser.getWindowForTarget", { targetId: workbench.targetId });
      await cdp.call("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal", width: expected.width, height: 900 } });
    }
    const found = [];
    for (const target of targetInfos.filter(t => ["page", "iframe", "webview"].includes(t.type))) {
      let sessionId;
      try {
        ({ sessionId } = await cdp.call("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
        await cdp.call("Runtime.enable", {}, sessionId);
        for (const contextId of cdp.contexts.get(sessionId) || []) {
          const result = await cdp.call("Runtime.evaluate", {
            contextId,
            expression: `JSON.stringify({
              step: document.body?.dataset.step,
              text: document.body?.innerText,
              source: document.querySelector("textarea")?.value,
              focused: document.activeElement?.id || document.activeElement?.dataset.action,
              focusVisible: document.activeElement?.matches(":focus-visible"),
              theme: document.body?.dataset.vscodeThemeKind,
              width: window.innerWidth,
              overflow: document.documentElement.scrollWidth > window.innerWidth,
              progress: document.querySelector("progress")?.value,
              images: [...document.querySelectorAll("img")].map(i => ({src:i.src, width:i.naturalWidth, height:i.naturalHeight})),
              buttons: [...document.querySelectorAll("button[data-action]")].map(b => ({action:b.dataset.action, disabled:b.disabled}))
            })`,
            returnByValue: true
          }, sessionId);
          const data = JSON.parse(result.result.value || "{}");
          if (data.step === undefined) continue;
          found.push(data);
          const match = !expected.absent
            && data.step === String(expected.step)
            && (!expected.text || data.text.includes(expected.text))
            && (expected.source === undefined || data.source === expected.source)
            && (!expected.png || data.images.some(i => i.src.startsWith("data:image/png;") && i.width > 0))
            && (!expected.theme || data.theme === expected.theme)
            && (!expected.focused || data.focused === expected.focused);
          if (!match) continue;
          if (expected.action || expected.input !== undefined || expected.focus) {
            const action = JSON.stringify({action:expected.action,input:expected.input,focus:expected.focus});
            const operation = await cdp.call("Runtime.evaluate", {
              contextId,
              expression: `(() => {
                const request = ${action};
                if (request.input !== undefined) {
                  const source = document.querySelector("textarea");
                  if (!source) throw Error("No source textarea");
                  source.focus();
                  source.value = request.input;
                  source.dispatchEvent(new Event("input", {bubbles:true}));
                }
                if (request.action) {
                  const button = document.querySelector('button[data-action="' + request.action + '"]');
                  if (!button || button.disabled) throw Error("Action unavailable: " + request.action);
                  button.click();
                }
                if (request.focus) {
                  const element = document.querySelector(request.focus);
                  if (!element) throw Error("Focus element missing");
                  element.focus();
                }
                return true;
              })()`,
              returnByValue: true
            }, sessionId);
            if (operation.exceptionDetails) return {ok:false, error:operation.exceptionDetails.text};
          }
          if (expected.key) {
            await cdp.call("Input.dispatchKeyEvent", {type:"keyDown", key:expected.key, code:expected.key, windowsVirtualKeyCode:9}, sessionId);
            await cdp.call("Input.dispatchKeyEvent", {type:"keyUp", key:expected.key, code:expected.key, windowsVirtualKeyCode:9}, sessionId);
          }
          if (expected.screenshot) {
            const capture = await cdp.call("Page.captureScreenshot", {format:"png"}, sessionId);
            fs.writeFileSync(path.join(temp, expected.screenshot + ".png"), Buffer.from(capture.data, "base64"));
          }
          return {ok:true, found, match:data};
        }
      } catch (_) { /* Targets can disappear while switching modes. */ }
      finally { if (sessionId) await cdp.call("Target.detachFromTarget", {sessionId}).catch(() => {}); }
    }
    return {ok: !!expected.absent && found.length === 0, found};
  } finally {cdp.close();}
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
  child.on("error", error => { exit = { error: String(error) }; });
  const interrupt = () => { child.kill(); process.exitCode = 130; };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
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
  } finally { child.kill(); fs.closeSync(log); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
})().catch(error => { console.error(error); process.exitCode = 1; });
