import * as vscode from "vscode";
import { SMALL_ICON_URL } from "../constants";

// The active-anchor marker of the webview playback mode: the small CodeTour
// logo alone in the gutter at the step's resolved anchor. Unlike the general
// tour markers (TOUR_DECORATOR), it carries no description, no comment block
// and no hover text, and it follows the active tour even when the general
// markers are hidden.
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
    const ranges =
      activeAnchor &&
      editor.document.uri.toString() === activeAnchor.uri.toString()
        ? [activeAnchor.range]
        : [];
    editor.setDecorations(ACTIVE_ANCHOR_DECORATOR, ranges);
  });
}

export function setActiveAnchorDecoration(anchor: ActiveAnchor | undefined) {
  activeAnchor = anchor;
  applyActiveAnchor();
}

export function clearActiveAnchorDecoration() {
  activeAnchor = undefined;
  vscode.window.visibleTextEditors.forEach(editor =>
    editor.setDecorations(ACTIVE_ANCHOR_DECORATOR, [])
  );
}

export function registerActiveAnchorModule(): vscode.Disposable {
  return vscode.window.onDidChangeVisibleTextEditors(() => applyActiveAnchor());
}
