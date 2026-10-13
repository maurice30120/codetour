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
    assert.ok(commands.includes("codetour.togglePlaybackMode"));
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
    
    await observe({step:1, text:"SMOKE_SECOND", action:"edit"});
    await observe({step:1, source:"SMOKE_SECOND", focused:"tour-step-source"});
    let richDraft = "SAVED_REAL_UI\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n**Diagram — Real smoke**\n\n\`\`\`mermaid\nflowchart TD\nA[Start] --> B[Done]\n\`\`\`";
    await observe({step:1, input:richDraft});
    await observe({step:1, source:richDraft, png:true});
    assert.equal(JSON.parse(fs.readFileSync(tourPath)).steps[1].description, "SMOKE_SECOND", "Input remains unsaved");
    checks.push("real textarea input updates Mermaid PNG preview without writing tour");
    await vscode.commands.executeCommand("codetour.togglePlaybackMode");
    await observe({absent:true});
    let nativeSource;
    for (let i = 0; i < 100; i++) {
      nativeSource = vscode.window.visibleTextEditors.find(e => e.document.isUntitled && e.document.languageId === "markdown" && e.document.getText() === richDraft);
      if (nativeSource) break;
      await pause(100);
    }
    assert.ok(nativeSource, "Native mode opens managed Markdown source with current unsaved WebView draft");
    richDraft += "\n\nNATIVE_SOURCE_EDIT";
    assert.ok(await nativeSource.edit(edit => edit.replace(new vscode.Range(0, 0, nativeSource.document.lineCount, 0), richDraft)));
    await vscode.commands.executeCommand("codetour.togglePlaybackMode");
    await observe({step:1, source:richDraft, png:true});
    assert.equal(JSON.parse(fs.readFileSync(tourPath)).steps[1].description, "SMOKE_SECOND");
    checks.push("native source edits survive mode switching without implicit persistence");

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await observe({absent:true});
    await vscode.commands.executeCommand("codetour.resumeTour");
    await observe({step:1, source:richDraft});
    checks.push("close and resume preserve unsaved real WebView draft");
    await observe({step:1, source:richDraft, action:"save"});
    await observe({step:1, text:"SAVED_REAL_UI", png:true});
    assert.equal(JSON.parse(fs.readFileSync(tourPath)).steps[1].description, richDraft);
    checks.push("real Save button persists exact Markdown and Mermaid source");
    await vscode.workspace.getConfiguration("codetour").update("playbackMode", "comments", vscode.ConfigurationTarget.Global);
    await observe({absent:true});
    await vscode.workspace.getConfiguration("codetour").update("playbackMode", "webview", vscode.ConfigurationTarget.Global);
    await observe({step:1, text:"SAVED_REAL_UI", png:true});
    checks.push("live playback setting changes switch the actual presentation");

    await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Default Light Modern", vscode.ConfigurationTarget.Global);
    const light = await observe({step:1, theme:"vscode-light", png:true, width:1000, screenshot:"webview-light-narrow", focus:'button[data-action="edit"]'});
    assert.ok(light.match.width <= 480, "Actual light WebView viewport is narrow");
    assert.equal(light.match.overflow, false, "Light narrow WebView has no horizontal overflow");
    await observe({step:1, focused:"edit", key:"Tab"});
    const keyboardFocus = await observe({step:1, focused:"editCommand"});
    assert.equal(keyboardFocus.match.focusVisible, true, "Keyboard Tab gives visible focus");
    await vscode.workspace.getConfiguration("workbench").update("colorTheme", "Default Dark Modern", vscode.ConfigurationTarget.Global);
    const dark = await observe({step:1, theme:"vscode-dark", png:true, screenshot:"webview-dark-narrow"});
    assert.ok(dark.match.width <= 480, "Actual dark WebView viewport is narrow");
    assert.equal(dark.match.overflow, false, "Dark narrow WebView has no horizontal overflow");
    assert.equal(dark.match.progress, 2, "Real progress element tracks last step");
    checks.push("light and dark screenshots, keyboard focus and progress verified");

    await vscode.commands.executeCommand("codetour.endTour");
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
    await vscode.commands.executeCommand("codetour.startTour", diffTour, 0, workspace);
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
    await vscode.commands.executeCommand("codetour.nextTourStep");
    await observe({step:1, text:"SMOKE_UNANCHORED_CONTENT"});
    checks.push("unanchored content step follows real diff playback");
    await vscode.commands.executeCommand("codetour.endTour");
    await observe({absent:true});

    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: true, checks }));
  } catch (error) {
    fs.writeFileSync(path.join(temp, "result.json"), JSON.stringify({ ok: false, checks, error: error.stack || String(error) }));
    throw error;
  }
};
