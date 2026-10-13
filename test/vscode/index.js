"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async function () {
  const temp = process.env.CODETOUR_HOST_TEST_DIR;
  if (!temp) throw new Error("Run through scripts/run-vscode-tests.js");
  const checks = [];
  let observationId = 0;
  async function observe(expected) {
    const id = ++observationId;
    fs.writeFileSync(path.join(temp, "observe.json"), JSON.stringify({ ...expected, id, deadline: Date.now() + 15000 }));
    const response = path.join(temp, "observed-" + id + ".json");
    for (let i = 0; i < 180 && !fs.existsSync(response); i++) await pause(100);
    assert.ok(fs.existsSync(response), "CDP observation runner responded");
    const result = JSON.parse(fs.readFileSync(response));
    assert.ok(result.ok, "Real WebView DOM: " + JSON.stringify({ expected, result }));
  }
  async function editorLine(line) {
    for (let i = 0; i < 100; i++) {
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath.endsWith("anchor.js"));
      if (editor && editor.selection.active.line === line) return;
      await pause(100);
    }
    assert.fail("Expected real anchor.js editor selection at line " + line);
  }
  try {
    const extension = vscode.extensions.getExtension("maurice30120.codetour");
    assert.ok(extension, "CodeTour extension discovered");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("codetour.togglePlaybackMode"));
    assert.ok(!commands.includes("codetour.prototypeTourWebview"), "Prototype command removed");
    checks.push("production commands registered");
    const workspace = vscode.workspace.workspaceFolders[0].uri;
    const tour = {
      id: vscode.Uri.joinPath(workspace, "smoke.tour").toString(),
      title: "Real host smoke", steps: [
        { file: "anchor.js", line: 1, description: "SMOKE_FIRST" },
        { file: "anchor.js", line: 2, description: "SMOKE_SECOND" }
      ]
    };
    await vscode.commands.executeCommand("codetour.startTour", tour, 0, workspace);
    await editorLine(0);
    await observe({ absent: true });
    checks.push("native playback opens real editor");
    await vscode.commands.executeCommand("codetour.togglePlaybackMode");
    await observe({ step: 0, text: "SMOKE_FIRST" });
    await editorLine(0);
    checks.push("toggle opens real WebView at same anchor");
    await vscode.commands.executeCommand("codetour.nextTourStep");
    await observe({ step: 1, text: "SMOKE_SECOND" });
    await editorLine(1);
    checks.push("next updates real DOM and editor anchor");
    await vscode.commands.executeCommand("codetour.resumeTour");
    await observe({ step: 1, text: "SMOKE_SECOND" });
    checks.push("resume preserves current step");
    await vscode.commands.executeCommand("codetour.togglePlaybackMode");
    await observe({ absent: true });
    await editorLine(1);
    checks.push("native toggle preserves current step");
    await vscode.commands.executeCommand("codetour.togglePlaybackMode");
    await observe({ step: 1, text: "SMOKE_SECOND" });
    await vscode.commands.executeCommand("codetour.endTour");
    await observe({ absent: true });
    checks.push("end disposes real WebView");
    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: true, checks }));
  } catch (error) {
    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: false, checks, error: error.stack || String(error) }));
    throw error;
  }
};
