// THROWAWAY PROTOTYPE: Does a WebView beside the code make tours easier to read?
// Three layouts on one surface, selected by ?variant=A/B/C. No tour writes.
import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { store } from "../store";
import { getStepFileUri, getWorkspaceUri } from "../utils";
import { renderPreviewDescription } from "./description";
import { getStepDiff } from "./diff";
import { createDescriptionWebviewHtml, renderMarkdownToHtml } from "./markdown";

const escape = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function registerTourWebviewPrototype(context: vscode.ExtensionContext) {
  // Expose the experiment in both development hosts and packaged installations.
  void vscode.commands.executeCommand("setContext", "codetour:prototypeAvailable", true);
  context.subscriptions.push(vscode.commands.registerCommand("codetour.prototypeWebview", async () => {
    const selected = await vscode.window.showQuickPick(store.tours.map(tour => ({
      label: tour.title, description: `${tour.steps.length} étapes`, tour
    })), { placeHolder: "Prototype WebView — choisir un tour" });
    if (!selected || !selected.tour.steps.length) return;
    const tour = selected.tour;
    const root = getWorkspaceUri(tour);
    const codeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
    const panel = vscode.window.createWebviewPanel("codetour.prototype", "Tour — prototype", {
      viewColumn: vscode.ViewColumn.Beside, preserveFocus: true
    }, { enableScripts: true, localResourceRoots: [] });
    context.subscriptions.push(panel);
    let index = 0;
    let variant = "A";
    let version = 0;
    let disposed = false;
    panel.onDidDispose(() => { disposed = true; ++version; });

    async function render() {
      const request = ++version;
      const contents = await Promise.all((variant === "C" ? tour.steps : [tour.steps[index]])
        .map(step => renderPreviewDescription(step.description, undefined, { tour, tours: store.tours, workspaceRoot: root })));
      if (disposed || request !== version) return;
      const step = tour.steps[index];
      const title = (n: number) => escape(tour.steps[n].title || `Étape ${n + 1}`);
      const nav = `<nav><button data-step="${index - 1}" ${index === 0 ? "disabled" : ""}>← Précédent</button><button data-action="code">Voir le code</button><button data-step="${index + 1}" ${index === tour.steps.length - 1 ? "disabled" : ""}>Suivant →</button><button data-action="close">Fermer</button></nav>`;
      const header = `<header><small>PROTOTYPE · ${escape(tour.title)}</small><p>${index + 1} / ${tour.steps.length}</p><progress value="${index + 1}" max="${tour.steps.length}"></progress></header>`;
      const article = `<article><h1>${title(index)}</h1><p class="anchor">${escape(step.file || step.directory || step.view || "Présentation")}${step.line ? ` : ${step.line}` : ""}${step.display === "diff" ? " · Diff" : ""}</p>${renderMarkdownToHtml(contents[0])}</article>`;
      const list = `<aside>${tour.steps.map((_, n) => `<button data-step="${n}" aria-current="${n === index ? "step" : "false"}">${n + 1}. ${title(n)}</button>`).join("")}</aside>`;
      // Build only the selected layout: A/B render one description, while C
      // renders all of them. Eagerly building C feeds undefined to Markdown.
      const layouts: Record<string, () => string> = {
        A: () => `${header}${article}${nav}`,
        B: () => `${header}<div class="split">${list}<section>${nav}${article}</section></div>`,
        C: () => `${header}${nav}<div class="timeline">${tour.steps.map((item, n) => `<article class="${n === index ? "active" : ""}"><button data-step="${n}">Ouvrir l’étape ${n + 1}</button><h2>${title(n)}</h2><p class="anchor">${escape(item.file || item.directory || item.view || "Présentation")}</p>${renderMarkdownToHtml(contents[n])}</article>`).join("")}</div>`
      };
      const state = { variant, step: index + 1, total: tour.steps.length, title: tour.title,
        anchor: { file: step.file, directory: step.directory, view: step.view, line: step.line, selection: step.selection, display: step.display }, ref: tour.ref, baseRef: tour.baseRef };
      const nonce = randomBytes(16).toString("base64");
      const html = createDescriptionWebviewHtml("", "Tour — prototype", nonce);
      panel.webview.html = html.replace("</head>", `<style>
        body{max-width:none;padding:24px 24px 100px}header{border-bottom:1px solid var(--vscode-panel-border);padding-bottom:16px}header p{margin:8px 0}progress{width:100%;accent-color:var(--vscode-button-background)}article{max-width:80ch;margin:24px auto}h1{margin-top:0}button{cursor:pointer;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:8px 12px;border-radius:4px}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid var(--vscode-focusBorder)}nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.anchor{font-family:var(--vscode-editor-font-family);opacity:.7}.split{display:grid;grid-template-columns:minmax(140px,30%) 1fr;gap:24px}aside{border-right:1px solid var(--vscode-panel-border);padding:20px 12px 0 0}aside button{display:block;text-align:left;width:100%;margin-bottom:8px;background:transparent;color:inherit}aside button[aria-current=step]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.timeline article{border-left:3px solid var(--vscode-panel-border);padding:20px;margin:20px 0;max-width:none;background:var(--vscode-textCodeBlock-background)}.timeline article.active{border-color:var(--vscode-focusBorder)}details{margin-top:24px}details pre{font-size:11px}.switcher{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--vscode-focusBorder);border-radius:30px;background:var(--vscode-editor-background);box-shadow:0 4px 20px #0006;white-space:nowrap}@media(max-width:450px){.split{grid-template-columns:1fr}aside{border:0}}
      </style></head>`).replace("<body>", `<body>${layouts[variant]()}<details><summary>État du prototype</summary><pre>${escape(JSON.stringify(state, null, 2))}</pre></details><div class="switcher"><button data-variant="-1" aria-label="Variante précédente">←</button><span>${variant} · ${{ A: "Lecture guidée", B: "Sommaire latéral", C: "Vue complète" }[variant]}</span><button data-variant="1" aria-label="Variante suivante">→</button></div><script nonce="${nonce}">
        const variants = ['A','B','C'];
        function switchVariant(delta) {
          const variant = variants[(variants.indexOf('${variant}') + delta + 3) % 3];
          const url = new URL(location.href); url.searchParams.set('variant', variant);
          try { history.replaceState(null, '', url); } catch {}
          vscode.postMessage({type:'variant', variant});
        }
        document.addEventListener('click', event => {
          const button = event.target.closest('button'); if (!button || button.disabled) return;
          if (button.dataset.variant) switchVariant(Number(button.dataset.variant));
          else if (button.dataset.step !== undefined) vscode.postMessage({type:'step', index:Number(button.dataset.step)});
          else vscode.postMessage({type:button.dataset.action});
        });
        document.addEventListener('keydown', event => {
          if (event.target.closest('input,textarea,[contenteditable]')) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); switchVariant(event.key === 'ArrowLeft' ? -1 : 1);
          }
        });
      </script>`);
    }

    async function openCode() {
      const step = tour.steps[index];
      if (step.directory) {
        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.joinPath(root!, step.directory));
        return;
      }
      if (!step.file && !step.uri && step.contents === undefined) return;
      const position = new vscode.Position(Math.max(0, (step.line || step.selection?.start.line || 1) - 1), 0);
      const selection = step.selection ? new vscode.Range(
        step.selection.start.line - 1, step.selection.start.character - 1,
        step.selection.end.line - 1, step.selection.end.character - 1
      ) : new vscode.Range(position, position);
      const diff = await getStepDiff(step, tour, root);
      if (disposed) return;
      if (diff) await vscode.commands.executeCommand("vscode.diff", diff.original, diff.modified, diff.title,
        { viewColumn: codeColumn, preserveFocus: true, selection });
      else await vscode.window.showTextDocument(await getStepFileUri(step, root, tour.ref),
        { viewColumn: codeColumn, preserveFocus: true, selection });
    }
    panel.webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === "variant" && ["A", "B", "C"].includes(message.variant)) {
          variant = message.variant; await render();
        } else if (message.type === "step" && Number.isInteger(message.index) && message.index >= 0 && message.index < tour.steps.length) {
          index = message.index; await render(); await openCode();
        } else if (message.type === "code") await openCode();
        else if (message.type === "close") panel.dispose();
        else if (message.type === "openLink" && typeof message.href === "string") {
          const uri = vscode.Uri.parse(message.href);
          if (["http", "https"].includes(uri.scheme)) await vscode.env.openExternal(uri);
        }
      } catch (error) { vscode.window.showWarningMessage(`Prototype CodeTour : ${String(error)}`); }
    });
    await render();
    try { await openCode(); } catch { /* The explanation remains readable if the file is missing. */ }
  }));
}
