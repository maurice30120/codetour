import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { createVscodeHost } from "../test/vscodeHost";

const host = createVscodeHost();
const moduleLoader = nodeModule as unknown as {
  _load: (request: string, ...args: unknown[]) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function(request: string, ...args: unknown[]) {
  return request === "vscode" ? host.vscode : originalLoad.apply(this, [request, ...args]);
};
const { registerPlayerModule } = require("./index");

// VS Code resolves an omitted viewColumn to the active editor group. Clicking
// the reading webview makes that group active, with no active text editor.
for (const codeColumn of [1, 2]) {
  test(`Next keeps code in group ${codeColumn} when the reading panel has focus`, async () => {
    host.livePanels("codetour.tour").forEach(panel => panel.dispose());
    host.visibleTextEditors.splice(0);
    host.setFileContent("src/first.ts", "const first = 1;");
    host.setFileContent("src/next.ts", "const next = 2;");
    const first = await host.vscode.window.showTextDocument(host.vscode.Uri.file("/workspace/src/first.ts"));
    Object.defineProperty(first, "viewColumn", { value: codeColumn });
    registerPlayerModule(host.extensionContext);
    await host.vscode.commands.executeCommand("codetour.startTour", {
      id: "file:///workspace/.tours/columns.tour", title: "Columns", steps: [
        { file: "src/first.ts", line: 1, description: "First" },
        { file: "src/next.ts", line: 1, description: "Next file" }
      ]
    });
    await host.vscode.commands.executeCommand("codetour.showStepDescription");
    await host.waitFor(() => host.panelHtml().includes("First"));
    const panel = host.livePanels("codetour.tour")[0];
    const panelColumn = codeColumn + 1;
    Object.defineProperty(panel, "viewColumn", { value: panelColumn });
    const activeDescriptor = Object.getOwnPropertyDescriptor(host.vscode.window, "activeTextEditor")!;
    Object.defineProperty(host.vscode.window, "activeTextEditor", { get: () => undefined, configurable: true });
    const show = host.vscode.window.showTextDocument;
    const openedIn: number[] = [];
    host.vscode.window.showTextDocument = async (value: Parameters<typeof show>[0], options?: { viewColumn?: number }) => {
      openedIn.push(options?.viewColumn ?? panelColumn);
      return show(value);
    };
    try {
      panel.receive({ type: "next" });
      await host.waitFor(() => host.panelHtml().includes("Next file"));
      assert.deepEqual(openedIn, [codeColumn], "new file must open in the code group, never in the webview group");
    } finally {
      host.vscode.window.showTextDocument = show;
      Object.defineProperty(host.vscode.window, "activeTextEditor", activeDescriptor);
      panel.dispose();
    }
  });
}
