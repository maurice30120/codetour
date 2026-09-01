import { ensureDomEnvironment, measureContentBounds } from "./dom";
import { rasterizeSvg } from "./rasterize";
import { sanitizeSvg } from "./sanitize";

export type DescriptionTheme = "light" | "dark";

export interface RenderedDiagram {
  svg: string;
  png: Buffer;
}

interface MermaidRenderResult {
  svg: string;
}

interface MermaidApi {
  initialize(config: unknown): void;
  parse(text: string): Promise<unknown>;
  render(id: string, text: string): Promise<MermaidRenderResult>;
}

const MERMAID_THEMES: Record<DescriptionTheme, "default" | "dark"> = {
  light: "default",
  dark: "dark"
};

let mermaid: MermaidApi | undefined;
let diagramCounter = 0;

async function loadMermaid(): Promise<MermaidApi> {
  const imported = await import("mermaid");
  return imported.default as unknown as MermaidApi;
}

function mermaidConfiguration(theme: DescriptionTheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: MERMAID_THEMES[theme],
    htmlLabels: false,
    flowchart: {
      htmlLabels: false
    }
  };
}

const VIEWBOX_PADDING = 2;

function normalizeSvgSize(svg: string): { svg: string; width: number } {
  const window = ensureDomEnvironment();
  const document = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;

  const viewBox = (root.getAttribute("viewBox") || "")
    .split(/[\s,]+/)
    .map(part => Number(part))
    .filter(part => !isNaN(part));

  let bounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };

  if (viewBox.length === 4) {
    bounds = { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  } else {
    bounds.width = Number(root.getAttribute("width")) || 800;
    bounds.height = Number(root.getAttribute("height")) || 600;
  }

  const content = measureContentBounds(root);
  bounds = {
    x: Math.min(bounds.x, content.x - VIEWBOX_PADDING),
    y: Math.min(bounds.y, content.y - VIEWBOX_PADDING),
    width: 0,
    height: 0
  };
  bounds.width = Math.max(
    viewBox.length === 4 ? viewBox[0] + viewBox[2] : bounds.width,
    content.x + content.width + VIEWBOX_PADDING
  ) - bounds.x;
  bounds.height = Math.max(
    viewBox.length === 4 ? viewBox[1] + viewBox[3] : bounds.height,
    content.y + content.height + VIEWBOX_PADDING
  ) - bounds.y;

  root.setAttribute(
    "viewBox",
    `${bounds.x} ${bounds.y} ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}`
  );
  root.setAttribute("width", String(Math.ceil(bounds.width)));
  root.setAttribute("height", String(Math.ceil(bounds.height)));
  root.removeAttribute("style");

  const normalized = new window.XMLSerializer().serializeToString(root);
  return { svg: normalized, width: bounds.width };
}

export async function renderMermaidDiagram(
  source: string,
  theme: DescriptionTheme
): Promise<RenderedDiagram> {
  ensureDomEnvironment();

  if (!mermaid) {
    mermaid = await loadMermaid();
  }

  mermaid.initialize(mermaidConfiguration(theme));
  await mermaid.parse(source);
  const { svg } = await mermaid.render(
    `codetour-diagram-${++diagramCounter}`,
    source
  );

  const sanitized = sanitizeSvg(svg);
  const normalized = normalizeSvgSize(sanitized);
  const png = rasterizeSvg(normalized.svg, normalized.width);

  return { svg: normalized.svg, png };
}
