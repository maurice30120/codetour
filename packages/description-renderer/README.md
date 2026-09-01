# codetour-description-renderer

Offline, strict-security Mermaid rendering for [CodeTour](https://github.com/microsoft/codetour)
Markdown descriptions. The renderer is the shared description-to-comment-content
seam: it accepts a complete Markdown description plus the effective VS Code theme
and returns the final Markdown used by a native VS Code comment, with each
`mermaid` fence replaced by an in-memory PNG image or a compact warning.

Design constraints:

- **Offline** — no font, image, script or config fetches; rendering works with
  network access blocked.
- **Strict security** — Mermaid runs with `securityLevel: "strict"` and
  `htmlLabels: false`; the intermediate SVG is additionally sanitized (scripts,
  event handlers, `foreignObject`, anchors, remote-resource elements and all
  external references removed) as defense in depth.
- **In-memory transport** — Mermaid produces a theme-aware SVG internally, which
  is rasterized to PNG with `@resvg/resvg-js` and emitted as a
  `data:image/png;base64` image; SVG data URIs did not display as images in
  native comments. No generated SVG or PNG file is ever written.
- **No generated assets** — the Mermaid source stays in the tour file; nothing
  is committed or persisted.
- **Reuse** — rendered diagrams are reused only in memory when their exact
  source, effective theme, renderer version and rendering options match. A
  theme change can call `clearMermaidRenderCache()` to discard all entries;
  failures are never kept in the cache. The MCP server (`packages/mcp-server`)
  will validate Mermaid with the same exact, locked Mermaid version and diagram
  rules through this package.

## Diagram rules

The rules below are implemented in `src/rules.ts` and are the single source of
truth shared by playback and (later) MCP validation. They are deliberately
syntactic and dependency-free so both sides evaluate them identically.

- **Fence**: a Mermaid fence is a block whose opening line matches
  `^\s*```mermaid[ \t]*$` and whose closing line is the next line that is only
  backticks (`^\s*```[ \t]*$`). A `mermaid` line nested inside another fence is
  not a Mermaid fence.
- **Caption**: the nearest non-blank line above the fence's opening line must
  be a caption: `^\s*\*\*(Diagram — …)\*\*[ \t]*$`, where `…` is one or more
  characters that do not contain `**`. Blank lines may sit between the caption
  and the fence; any other content breaks the association. The caption stays
  visible and becomes the image alternative text.
- **Allowlist**: the diagram kind is the first whitespace-delimited token of
  the first significant source line (blank lines and `%%` comment/init-directive
  lines are skipped). Exactly `flowchart`, `sequenceDiagram`,
  `stateDiagram-v2`, `classDiagram` and `erDiagram` are supported; aliases such
  as `graph` or `stateDiagram` are not.
- **Count limit**: at most 3 Mermaid fences per description, counted in
  document order. During playback the first three fences are evaluated and each
  fence from the fourth on fails locally with a warning, regardless of its
  content. Validation (MCP) rejects the whole description when it contains more
  than 3 fences.
- **Size limit**: the UTF-8 byte length of the source (the exact text between
  the opening and closing fence lines) must be at most 20 KB (20480 bytes).
- **Per-fence evaluation order**: caption, then size, then kind. The first
  violated rule decides the failure. Diagrams in one description are evaluated
  and rendered independently, so one rejected diagram never hides its siblings.
- **Failures**: a rejected or unrenderable diagram is replaced by a single
  compact warning line and never by its source. `renderMermaidDiagram` also
  refuses unsupported kinds on its own, so the low-level API is safe to call
  directly.

## API

```ts
type DescriptionTheme = "light" | "dark";

renderDescription(description: string, theme: DescriptionTheme): Promise<string>;
renderMermaidDiagram(source: string, theme: DescriptionTheme): Promise<{ svg: string; png: Buffer }>;
clearMermaidRenderCache(): void;
invalidateMermaidRenderCache(): void; // alias used by theme-change callers
sanitizeSvg(svg: string): string;
```

`renderDescription` is the shared Markdown transformation used by playback
surfaces. Its diagram work is backed by the in-memory cache; no cache entry or
generated image is written to the workspace or persisted in VS Code state.
`DESCRIPTION_RENDERER_VERSION` identifies the output contract represented by
the cache.

Shared rule surface (for playback and MCP validation):

```ts
ALLOWED_DIAGRAM_KINDS: readonly ["flowchart", "sequenceDiagram", "stateDiagram-v2", "classDiagram", "erDiagram"];
MAX_DIAGRAMS_PER_DESCRIPTION: 3;
MAX_DIAGRAM_SOURCE_BYTES: 20480;

findDiagramFences(description: string): DiagramFence[]; // caption?, source, start, end
matchDiagramCaption(line: string): string | undefined;
diagramKindOf(source: string): string | undefined;
diagramSourceByteLength(source: string): number;
isAllowedDiagramKind(kind: string): boolean;
isMermaidFenceInfo(info: string): boolean;
evaluateDiagramFence(fence: { caption?: string; source: string }): DiagramFenceEvaluation;
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
polyfills), validated against all five allowed diagram kinds.
