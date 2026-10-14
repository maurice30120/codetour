import { test } from "node:test";
import * as assert from "node:assert";
import * as nodeModule from "module";
import { ColorThemeKind, createVscodeHost } from "../test/vscodeHost";

// The reader-level checks for the rich contents of the reading panel: Mermaid
// rendering and fallback, images, tables, description links with their
// permissions, hot theme changes and stale renders during rapid navigation.
const host = createVscodeHost({
  configuration: {
    codetour: { playbackMode: "webview", showMarkers: false }
  }
});

const originalLoad = (nodeModule as unknown as { _load: unknown })._load as (
  request: string,
  ...args: unknown[]
) => unknown;
(nodeModule as unknown as { _load: unknown })._load = function (
  request: string,
  ...args: unknown[]
) {
  if (request === "vscode") {
    return host.vscode;
  }
  return originalLoad.apply(this, [request, ...args]);
};

const { registerPlayerModule } = require("../player");
const { store } = require("../store");

const mermaidSource = [
  "**Diagram — Flow**",
  "",
  "```mermaid",
  "flowchart TD",
  "    Start --> Render --> Done",
  "```"
].join("\n");

const tour = {
  id: "file:///workspace/.tours/rich.tour",
  title: "1 - Rich Tour",
  description: "A tour with rich contents",
  steps: [
    {
      title: "Mermaid overview",
      description: `Intro before the diagram.\n\n${mermaidSource}\n\nOutro after the diagram.`,
      file: "src/player.ts",
      line: 3
    },
    {
      title: "Broken diagram",
      description: [
        "Still readable intro.",
        "",
        "**Diagram — Broken**",
        "",
        "```mermaid",
        'pie "Share" : 100',
        "```",
        "",
        "Still readable outro."
      ].join("\n")
    },
    {
      title: "Rich content",
      description: [
        "| Column | Value |",
        "| --- | --- |",
        "| Alpha | One |",
        "",
        "![Logo](https://example.com/logo.png)",
        "",
        "See [#1], [the docs](https://example.com/docs) or [setup](./setup.md)."
      ].join("\n")
    }
  ]
};

function seedWorkspace() {
  host.setFileContent(
    "src/player.ts",
    ['import { store } from "./store";', "", "startPlayer();"].join("\n")
  );
}

async function startTour() {
  seedWorkspace();
  await host.vscode.commands.executeCommand("codetour.startTour", tour);
}

function panelHtml() {
  return host.panelHtml();
}

function diagramSrc(html: string): string | undefined {
  return html.match(/src="(data:image\/png;base64,[^"]+)"/)?.[1];
}

async function goToMermaidStep() {
  await host.vscode.commands.executeCommand("codetour.navigateToStep", 1);
  await host.waitFor(() => !!diagramSrc(panelHtml()));
}

test("a mermaid diagram renders in the reading panel with its caption as alt text", async () => {
  registerPlayerModule(host.extensionContext);
  await startTour();

  await host.waitFor(() => panelHtml().includes("data:image/png;base64"), 5000);

  const html = panelHtml();
  // The diagram becomes a data-URI image carrying the caption as alt text,
  // and the surrounding text stays readable around it.
  assert.match(html, /<img[^>]*src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  assert.match(html, /alt="Diagram — Flow"/);
  assert.match(html, /<p>Intro before the diagram\.<\/p>/);
  assert.match(html, /<p>Outro after the diagram\.<\/p>/);
  // The Mermaid source never reaches the panel.
  assert.doesNotMatch(html, /flowchart TD/);
  assert.doesNotMatch(html, /```mermaid/);
});

test("an invalid diagram falls back to the shared notice without hiding the rest", async () => {
  const panel = host.livePanels("codetour.tour")[0]!;

  panel.receive({ type: "next" });
  await host.waitFor(() => panelHtml().includes("2 / 3"));

  const html = panelHtml();
  assert.match(html, /Unsupported Mermaid diagram kind/);
  assert.match(html, /<p>Still readable intro\.<\/p>/);
  assert.match(html, /<p>Still readable outro\.<\/p>/);
  assert.doesNotMatch(html, /data:image\/png;base64/);
});

test("tables, images and tour references render through the shared pipeline", async () => {
  const panel = host.livePanels("codetour.tour")[0]!;

  panel.receive({ type: "next" });
  await host.waitFor(() => panelHtml().includes("3 / 3"));

  const html = panelHtml();
  assert.match(html, /<table>/);
  assert.match(html, /<td>Alpha<\/td>/);
  assert.match(html, /<img[^>]*src="https:\/\/example\.com\/logo\.png"/);
  assert.match(html, /alt="Logo"/);
  assert.match(html, /href="command:codetour\.navigateToStep\?1"/);
  assert.match(html, /href="command:vscode\.open\?/);
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
});

test("description links keep the shared permissions and need explicit clicks", async () => {
  const panel = host.livePanels("codetour.tour")[0]!;
  const stepLink = panelHtml().match(
    /href="(command:codetour\.navigateToStep\?[^"]+)"/
  )![1];

  panel.receive({ type: "openLink", href: stepLink });
  await host.waitFor(() => store.activeTour?.step === 0);
  await host.waitFor(() => panelHtml().includes("1 / 3"));

  // Malformed messages are ignored instead of trusted.
  panel.receive({ type: "openLink" });
  panel.receive({ type: "unknown" });

  await host.vscode.commands.executeCommand("codetour.navigateToStep", 3);
  await host.waitFor(() => panelHtml().includes("3 / 3"));

  // External links open through the host, workspace files through vscode.open.
  panel.receive({ type: "openLink", href: "https://example.com/docs" });
  await host.waitFor(() => host.externalLinks.length === 1);
  assert.equal(host.externalLinks[0].toString(), "https://example.com/docs");

  const fileLink = panelHtml().match(
    /href="(command:vscode\.open\?[^"]+)"/
  )![1];
  panel.receive({ type: "openLink", href: fileLink });
  await host.waitFor(() =>
    host.executedCommands.some(([id, args]) => {
      const target = args[0] as { scheme?: string; path?: string } | undefined;
      return (
        id === "vscode.open" &&
        target?.scheme === "file" &&
        target?.path === "/workspace/setup.md"
      );
    })
  );

  // Commands outside the allowlist never execute, even from a crafted link.
  panel.receive({
    type: "openLink",
    href: "command:workbench.action.toggleSidebarPosition"
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(!host.executedCommands.some(([id]) => id.startsWith("workbench.")));
  assert.equal(store.activeTour?.step, 2);
  assert.equal(host.messages.length, 0);
});

test("hot theme changes refresh the panel and its diagrams", async () => {
  await goToMermaidStep();
  const lightSrc = diagramSrc(panelHtml());

  host.changeColorTheme(ColorThemeKind.Dark);
  await host.waitFor(() => {
    const src = diagramSrc(panelHtml());
    return !!src && src !== lightSrc;
  }, 5000);
  assert.match(panelHtml(), /1 \/ 3/);
  assert.match(panelHtml(), /alt="Diagram — Flow"/);

  host.changeColorTheme(ColorThemeKind.Light);
  await host.waitFor(() => diagramSrc(panelHtml()) === lightSrc, 5000);
  assert.match(panelHtml(), /1 \/ 3/);
});

test("rapid navigation during a mermaid render keeps the latest requested step", async () => {
  await goToMermaidStep();

  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("2 / 3"));

  // Let any delayed mermaid render settle: it must not replace the step the
  // reader last requested.
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.match(panelHtml(), /2 \/ 3/);
  assert.match(panelHtml(), /<h1>Broken diagram<\/h1>/);
  assert.doesNotMatch(panelHtml(), /data:image\/png;base64/);
});

test("closing the panel during a pending mermaid render keeps the latest requested step", async () => {
  await goToMermaidStep();

  // Ask for the mermaid step again, then close the panel while its
  // presentation render is still pending.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("2 / 3"));
  await host.vscode.commands.executeCommand("codetour.previousTourStep");
  host.livePanels("codetour.tour")[0]!.dispose();
  await new Promise(resolve => setTimeout(resolve, 500));

  // The close ends the presentation, not the tour: the requested step is
  // kept, and the delayed mermaid render neither reopens the closed panel
  // nor resurrects an older step behind the reader's back.
  assert.equal(store.activeTour?.step, 0);
  assert.equal(host.contexts.get("codetour:inTour"), true);
  assert.equal(host.livePanels("codetour.tour").length, 0);

  // The reader continues from the requested step.
  await host.vscode.commands.executeCommand("codetour.nextTourStep");
  await host.waitFor(() => panelHtml().includes("2 / 3"));
  assert.match(panelHtml(), /<h1>Broken diagram<\/h1>/);
});
