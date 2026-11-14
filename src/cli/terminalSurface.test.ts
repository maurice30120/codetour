import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalTransport } from "@b9g/termdom";
import stringWidth = require("string-width");
import { NarrationController } from "./narration/NarrationController";
import { createReader } from "./reader/reader";
import { TermDomSurface } from "./terminal";

// Use the real cell renderer on a memory transport. A browser's CSS engine
// would miss both the unpainted canvas and the RGB-to-256 diff regression.
const { TermDOM } = require("@b9g/termdom") as typeof import("@b9g/termdom");

async function surfaceAt(columns: number, colorDepth: 8 | 24 = 8) {
  const transport: TerminalTransport = {
    cols: columns,
    rows: 36,
    interactive: false,
    sharesScreen: false,
    readable: new ReadableStream<string>(),
    writable: new WritableStream<string>({ write: () => undefined }),
    resizes: new ReadableStream(),
    ready: Promise.resolve(),
    closed: new Promise(() => undefined),
    close: () => undefined
  };
  // Intentionally light: the reader must paint its dark surface regardless
  // of the host's preference or its answer to a background-colour query.
  const term = new TermDOM({ transport, colorScheme: "light", colorDepth });
  const reader = createReader({
    root: "/workspace",
    columns,
    rows: transport.rows,
    tour: {
      id: "terminal-surface",
      title: "PDF authentication",
      steps: [{ title: "Token endpoint", file: "controller.cs", line: 41, description: "Token validation" }]
    },
    speech: new NarrationController({
      engine: { speak: async () => undefined, cancel: () => undefined, dispose: () => undefined }
    }),
    responder: { providerName: "Test", answer: async () => "An answer" },
    descriptionRenderer: async () => "<p>" +
      "Read the explanation alongside the code. ".repeat(8) +
      "<code>Token()</code></p><pre><code>example code</code></pre>",
    resolveStepContext: () => ({
      kind: "diff",
      label: "controller.cs",
      text: [
        "diff --git a/controller.cs b/controller.cs",
        "--- a/controller.cs",
        "+++ b/controller.cs",
        "@@ -41,3 +41,3 @@",
        " public class Controller {",
        "-    return old_token;",
        "+    return new_token;",
        " }"
      ].join("\n")
    })
  });
  await reader.open();
  const surface = new TermDomSurface({ term, document: term.document, reader });
  surface.paint();
  const ansi = term.renderANSI();
  return { term, reader, surface, ansi };
}

type RGB = [number, number, number];

function indexedColor(index: number): RGB {
  if (index >= 232) return [0, 0, 0].map(() => 8 + (index - 232) * 10) as RGB;
  assert.ok(index >= 16, "the reader uses explicit RGB colours, not host theme colours");
  const cube = [0, 95, 135, 175, 215, 255];
  const value = index - 16;
  return [cube[Math.floor(value / 36)], cube[Math.floor(value / 6) % 6], cube[value % 6]];
}

/** Read colours from renderANSI's SGR runs, after TermDOM quantizes them. */
function colorsAt(ansi: string, text: string): { foreground: RGB; background: RGB } {
  let foreground: RGB | undefined;
  let background: RGB | undefined;
  for (const run of ansi.matchAll(/\x1b\[([\d;]*)m|([^\x1b]+)/g)) {
    if (run[1] !== undefined) {
      const codes = run[1].split(";").map(Number);
      for (let index = 0; index < codes.length; index++) {
        if (codes[index] === 0) {
          foreground = background = undefined;
        } else if (codes[index] === 38 || codes[index] === 48) {
          const isForeground = codes[index] === 38;
          const rgb = codes[index + 1] === 5
            ? indexedColor(codes[index + 2])
            : codes.slice(index + 2, index + 5) as RGB;
          if (isForeground) foreground = rgb;
          else background = rgb;
          index += codes[index + 1] === 5 ? 2 : 4;
        }
      }
    } else if (run[2].includes(text)) {
      assert.ok(foreground && background, "text must have explicit foreground and background");
      return { foreground, background };
    }
  }
  throw new Error("Rendered text not found: " + text);
}

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(value => {
    const component = value / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: RGB, background: RGB): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test("a light host still paints the entire reader dark with readable prose", async () => {
  const { term, surface, ansi } = await surfaceAt(180);
  try {
    for (const selector of ["html", "body", ".body", ".content", ".topbar"]) {
      const element = term.document.querySelector(selector)!;
      const background = term.window.getComputedStyle(element).backgroundColor;
      assert.match(background, /^rgb\((10, 10, 10|20, 20, 20)\)$/, selector);
    }
    assert.equal(term.document.body.getBoundingClientRect().height, 36);
    const { foreground, background } = colorsAt(ansi, "Read the explanation");
    assert.ok(contrast(foreground, background) >= 7, "body text must retain strong contrast");
    assert.equal(term.window.getComputedStyle(term.document.querySelector("code")!).backgroundColor,
      "rgba(0, 0, 0, 0)");
  } finally {
    await surface.teardown();
  }
});

test("added and removed lines retain contrast after 256-colour and RGB rendering", async () => {
  for (const depth of [8, 24] as const) {
    const { surface, ansi } = await surfaceAt(160, depth);
    try {
      for (const text of ["return new_token;", "return old_token;"]) {
        const { foreground, background } = colorsAt(ansi, text);
        assert.ok(luminance(background) < 0.04, "diff background must stay dark at depth " + depth);
        assert.ok(contrast(foreground, background) >= 4.5, "diff contrast at depth " + depth);
      }
      const added = colorsAt(ansi, "return new_token;").foreground;
      const removed = colorsAt(ansi, "return old_token;").foreground;
      assert.ok(added[1] > added[0], "added text must stay green");
      assert.ok(removed[0] > removed[1], "removed text must stay red");
    } finally {
      await surface.teardown();
    }
  }
});

test("the rendered reader fits narrow and wide screens and bounds prose independently of source", async () => {
  for (const columns of [60, 80, 100, 120, 240]) {
    const { term, reader, surface } = await surfaceAt(columns);
    try {
      for (const selector of [".content", ".conversation", ".composer", ".status-right", ".source"]) {
        const bounds = term.document.querySelector(selector)!.getBoundingClientRect();
        assert.ok(bounds.left >= 0 && bounds.right <= columns, selector + " at " + columns);
      }
      const sourceBody = term.document.querySelector(".source-body")!;
      const sourceStyle = term.window.getComputedStyle(sourceBody);
      const rowWidth = sourceBody.getBoundingClientRect().width -
        parseFloat(sourceStyle.paddingLeft) - parseFloat(sourceStyle.paddingRight);
      for (const row of Array.from(term.document.querySelectorAll(".source-line"))) {
        assert.ok(stringWidth(row.textContent || "") <= rowWidth,
          "source text must not be clipped at " + columns);
      }
      const prose = term.document.querySelector(".step-description p")!.getBoundingClientRect();
      assert.ok(prose.width <= 78, "paragraph width at " + columns);
      if (columns === 240) {
        const code = term.document.querySelector(".source-body")!.getBoundingClientRect();
        assert.ok(code.width > prose.width, "source can use the larger viewport");
      }
      reader.pressKey({ key: "a" });
      surface.paint();
      term.renderANSI();
      const composer = term.document.querySelector(".composer")!;
      assert.ok(composer.classList.contains("asking"));
      assert.notEqual(term.window.getComputedStyle(composer).borderTopColor,
        term.window.getComputedStyle(term.document.querySelector(".source")!).borderTopColor);
    } finally {
      await surface.teardown();
    }
  }
});
