import * as vscode from "vscode";

// Commands proposed inside a rendered description stay limited to CodeTour's
// own commands and vscode.open; the playback webviews must not widen this.
const ALLOWED_COMMANDS = /^(codetour\.|vscode\.open$)/;

function reviveCommandArgument(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "scheme" in value &&
    "path" in value
  ) {
    const components = value as {
      scheme: string;
      authority?: string;
      path?: string;
      query?: string;
      fragment?: string;
    };
    return vscode.Uri.from({
      scheme: components.scheme,
      authority: components.authority,
      path: components.path,
      query: components.query,
      fragment: components.fragment
    });
  }

  return value;
}

// Opens a link clicked in an extension-owned description surface, applying the
// shared allowlist and workspace-relative resolution.
export async function openDescriptionLink(
  href: string,
  workspaceRoot?: vscode.Uri
): Promise<void> {
  const uri = vscode.Uri.parse(href, true);
  if (uri.scheme === "command" && ALLOWED_COMMANDS.test(uri.path)) {
    const parsedArgs: unknown = uri.query
      ? JSON.parse(decodeURIComponent(uri.query))
      : [];
    const args = (Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs]).map(
      reviveCommandArgument
    );
    await vscode.commands.executeCommand(uri.path, ...args);
  } else if (["http", "https", "mailto"].includes(uri.scheme)) {
    await vscode.env.openExternal(uri);
  } else if (!uri.scheme && workspaceRoot) {
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.joinPath(workspaceRoot, uri.path)
    );
  }
}

// Opens a link clicked in an extension-owned description surface and reports
// the failure instead of letting it break the surface. Every description
// webview routes its openLink messages through here.
export async function openDescriptionLinkOrReport(
  href: string,
  workspaceRoot?: vscode.Uri
): Promise<void> {
  try {
    await openDescriptionLink(href, workspaceRoot);
  } catch {
    vscode.window.showErrorMessage(
      "Unable to open this description link."
    );
  }
}
