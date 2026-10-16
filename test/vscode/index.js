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
    return result;
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
    assert.ok(commands.includes("codetourIA.showStepDescription"));
    assert.ok(!commands.includes("codetour.togglePlaybackMode"));
    assert.ok(!commands.includes("codetour.prototypeWebview"), "Prototype command removed");
    checks.push("production commands registered");
    const workspace = vscode.workspace.workspaceFolders[0].uri;
    const tour = {
      id: vscode.Uri.joinPath(workspace, "smoke.tour").toString(),
      title: "Real host smoke", steps: [
        { file: "anchor.js", line: 1, description: "SMOKE_FIRST" },
        { file: "anchor.js", line: 2, description: "SMOKE_SECOND" }
      ]
    };
    const tourPath = vscode.Uri.parse(tour.id).fsPath;
    fs.writeFileSync(tourPath, JSON.stringify({...tour, id:undefined}, null, 2));
    await vscode.commands.executeCommand("codetourIA.startTour", tour, 0, workspace);
    await editorLine(0);
    await observe({ absent: true });
    checks.push("native playback opens real editor");
    async function closeExpanded() {
      const panelTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputWebview && tab.label.includes(tour.title));
      assert.ok(panelTab, "Expanded reading tab exists");
      assert.ok(await vscode.window.tabGroups.close(panelTab));
      await observe({ absent: true });
    }
    await vscode.commands.executeCommand("codetourIA.showStepDescription");
    const first = await observe({ step: 0, text: "SMOKE_FIRST" });
    assert.deepEqual(first.match.buttons, [{action:"previous", disabled:true}, {action:"next", disabled:false}]);
    assert.equal(first.match.source, undefined, "Reading view has no source editor");
    assert.equal(await vscode.commands.executeCommand("codetourIA._getActiveCommentBody"), undefined);
    await editorLine(0);
    checks.push("expanded action opens a single reading view with compact navigation");
    await observe({step:0, click:"next"});
    await observe({ step: 1, text: "SMOKE_SECOND" });
    await editorLine(1);
    await vscode.commands.executeCommand("codetourIA.resumeTour");
    await observe({ step: 1, text: "SMOKE_SECOND" });
    checks.push("extension navigation and resume update the real DOM and editor");
    await closeExpanded();
    for (let i = 0; i < 100; i++) {
      const body = await vscode.commands.executeCommand("codetourIA._getActiveCommentBody");
      if (body && body.includes("SMOKE_SECOND")) break;
      await pause(100);
    }
    assert.match(await vscode.commands.executeCommand("codetourIA._getActiveCommentBody"), /SMOKE_SECOND/);
    await vscode.commands.executeCommand("codetourIA.showStepDescription");
    await observe({ step: 1, text: "SMOKE_SECOND" });
    checks.push("closing restores the native comment at the same step");

    await vscode.commands.executeCommand("codetourIA.editTour");
    await observe({ absent: true });
    let nativeSource;
    for (let i = 0; i < 100; i++) {
      nativeSource = vscode.window.visibleTextEditors.find(e => e.document.isUntitled && e.document.languageId === "markdown" && e.document.getText() === "SMOKE_SECOND");
      if (nativeSource) break;
      await pause(100);
    }
    assert.ok(nativeSource, "Edit opens managed native Markdown source");
    const richDraft = [
      "SAVED_REAL_UI",
      "| One | Two |\n| --- | --- |\n| A | B |",
      "**Diagram — Real smoke**",
      "```mermaid\nflowchart TD\nA[Start] --> B[Done]\n```",
      "This long explanation checks wrapping in a narrow panel. ".repeat(35),
      "LONG_IDENTIFIER_" + "X".repeat(350),
      "[Documentation](https://example.invalid/docs)"
    ].join("\n\n");
    assert.ok(await nativeSource.edit(edit => edit.replace(new vscode.Range(0, 0, nativeSource.document.lineCount, 0), richDraft)));
    assert.equal(JSON.parse(fs.readFileSync(tourPath)).steps[1].description, "SMOKE_SECOND");
    await vscode.commands.executeCommand("codetourIA.saveTourStep");
    assert.equal(JSON.parse(fs.readFileSync(tourPath)).steps[1].description, richDraft);
    await vscode.commands.executeCommand("codetourIA.showStepDescription");
    await observe({ step: 1, text: "SAVED_REAL_UI", png: true, reading: true });
    checks.push("native editing saves exact Markdown and Mermaid for expanded reading");

    await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Default Light Modern", vscode.ConfigurationTarget.Global);
    const light = await observe({step:1, theme:"vscode-light", png:true, width:1000, screenshot:"webview-light-narrow"});
    assert.ok(light.match.width <= 480);
    assert.equal(light.match.overflow, false);
    assert.equal(light.match.buttons.length, 2);
    await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Default Dark Modern", vscode.ConfigurationTarget.Global);
    const dark = await observe({step:1, theme:"vscode-dark", png:true, screenshot:"webview-dark-narrow"});
    assert.ok(dark.match.width <= 480);
    assert.equal(dark.match.overflow, false);
    assert.equal(dark.match.progress, 2);
    checks.push("real light and dark narrow reading views render compact navigation without overflow");

    await vscode.commands.executeCommand("codetourIA.endTour");
    await observe({ absent: true });
    checks.push("end disposes real WebView");
    const refs = JSON.parse(fs.readFileSync(path.join(temp, "git-fixture.json")));
    const diffTour = {
      id: vscode.Uri.joinPath(workspace, "diff-smoke.tour").toString(),
      title:"Real Git diff smoke", baseRef:refs.baseRef, ref:refs.headRef,
      steps:[
        {file:"diff.js", display:"diff", line:2, description:"SMOKE_DIFF"},
        {description:"SMOKE_UNANCHORED_CONTENT"}
      ]
    };
    // Initialize the real built-in Git extension before exercising snapshots.
    const gitApi = (await vscode.extensions.getExtension("vscode.git").activate()).getAPI(1);
    for (let i = 0; i < 100 && !gitApi.getRepository(vscode.Uri.joinPath(workspace, "diff.js")); i++) await pause(100);
    assert.ok(gitApi.getRepository(vscode.Uri.joinPath(workspace, "diff.js")), "Real Git extension discovers isolated fixture repository");
    await vscode.commands.executeCommand("codetourIA.startTour", diffTour, 0, workspace);
    await vscode.commands.executeCommand("codetourIA.showStepDescription");
    await observe({step:0, text:"SMOKE_DIFF"});
    let diffEditors;
    for (let i = 0; i < 100; i++) {
      diffEditors = vscode.window.visibleTextEditors.filter(e => e.document.uri.scheme === "git" && e.document.uri.fsPath.endsWith("diff.js"));
      if (diffEditors.length === 2) break;
      await pause(100);
    }
    assert.equal(diffEditors.length, 2, "Real diff displays original and modified snapshot documents");
    const snapshots = diffEditors.map(e => ({ref:JSON.parse(e.document.uri.query).ref, text:e.document.getText()}));
    assert.ok(snapshots.some(s => s.ref === refs.baseRef && s.text.includes("const revised = 1;")), "Original real Git snapshot");
    assert.ok(snapshots.some(s => s.ref === refs.headRef && s.text.includes("const revised = 2;")), "Modified real Git snapshot");
    checks.push("real Git diff opens exact original and modified revisions");
    await vscode.commands.executeCommand("codetourIA.nextTourStep");
    await observe({step:1, text:"SMOKE_UNANCHORED_CONTENT"});
    checks.push("unanchored content step follows real diff playback");
    await vscode.commands.executeCommand("codetourIA.endTour");
    await observe({absent:true});

    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: true, checks }));
  } catch (error) {
    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: false, checks, error: error.stack || String(error) }));
    throw error;
  }
};
