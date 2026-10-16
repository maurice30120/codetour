import * as vscode from "vscode";
import { SMALL_ICON_URL } from "../constants";

// The active-anchor marker of the webview playback mode: the small CodeTour
// logo alone in the gutter at the step's resolved anchor. Unlike the general
// tour markers (TOUR_DECORATOR), it carries only a concise open link on the
// anchored line’s hover. The description stays in the webview, and the marker
// remains visible even when the general markers are hidden.
const ACTIVE_ANCHOR_DECORATOR = vscode.window.createTextEditorDecorationType({
  gutterIconPath: vscode.Uri.parse(SMALL_ICON_URL),
  gutterIconSize: "contain",
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});

export interface ActiveAnchor {
  uri: vscode.Uri;
  range: vscode.Range;
}

let activeAnchor: ActiveAnchor | undefined;

function applyActiveAnchor(): void {
  vscode.window.visibleTextEditors.forEach(editor => {
    const link = new vscode.MarkdownString(
      '[Ouvrir la webview](command:codetour.showStepDescription "Afficher cette étape")'
    );
    link.isTrusted = { enabledCommands: ["codetour.showStepDescription"] };
    const ranges =
      activeAnchor &&
      editor.document.uri.toString() === activeAnchor.uri.toString()
        ? [{ range: editor.document.lineAt(Math.min(activeAnchor.range.start.line, editor.document.lineCount - 1)).range, hoverMessage: link }]
        : [];
    editor.setDecorations(ACTIVE_ANCHOR_DECORATOR, ranges);
  });
}

export function setActiveAnchorDecoration(anchor: ActiveAnchor | undefined) {
  activeAnchor = anchor;
  applyActiveAnchor();
}

export function clearActiveAnchorDecoration() {
  setActiveAnchorDecoration(undefined);
}

export function registerActiveAnchorModule(): vscode.Disposable {
  return vscode.window.onDidChangeVisibleTextEditors(() => applyActiveAnchor());
}
