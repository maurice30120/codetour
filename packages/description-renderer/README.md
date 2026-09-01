# codetour-description-renderer

Offline, strict-security Mermaid rendering for [CodeTour](https://github.com/microsoft/codetour)
Markdown descriptions. The renderer is the shared description-to-comment-content
seam: it accepts a complete Markdown description plus the effective VS Code theme
and returns the final Markdown used by a native VS Code comment, with each
captioned `mermaid` fence replaced by an in-memory PNG image.

Design constraints:

- **Offline** — no font, image, script or config fetches; rendering works with
  network access blocked.
- **Strict security** — Mermaid runs with `securityLevel: "strict"` and
  `htmlLabels: false`; the intermediate SVG is additionally sanitized (scripts,
  event handlers, `foreignObject`, anchors and dangerous links removed) as
  defense in depth.
- **In-memory transport** — Mermaid produces a theme-aware SVG internally, which
  is rasterized to PNG with `@resvg/resvg-js` and emitted as a
  `data:image/png;base64` image; SVG data URIs did not display as images in
  native comments. No generated SVG or PNG file is ever written.
- **No generated assets** — the Mermaid source stays in the tour file; nothing
  is committed or persisted.
- **Reuse** — the MCP server (`packages/mcp-server`) will validate Mermaid with
  the same exact, locked Mermaid version and diagram rules through this package.

A Mermaid fence is introduced by a visible caption of the form
`**Diagram — …**`, which stays visible and becomes the image alternative text.
An uncaptioned fence currently passes through unchanged; strict caption and
diagram rules arrive with the allowlist work.

## API

```ts
type DescriptionTheme = "light" | "dark";

renderDescription(description: string, theme: DescriptionTheme): Promise<string>;
renderMermaidDiagram(source: string, theme: DescriptionTheme): Promise<{ svg: string; png: Buffer }>;
sanitizeSvg(svg: string): string;
```

## Development

From the repository root:

```bash
npm ci --prefix packages/description-renderer
npm test --prefix packages/description-renderer
```

Dependencies are exact-pinned (`mermaid` 11.12.2, `jsdom` 26.1.0,
`@resvg/resvg-js` 2.6.2) so every consumer renders with the same locked
versions. JSDOM has no real SVG layout: text measurement relies on bounded
heuristics (`getBBox`, `getComputedTextLength`, `getBoundingClientRect`
polyfills), validated against `flowchart`.
