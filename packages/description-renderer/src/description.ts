import { findDiagramFences } from "./parse";
import {
  DescriptionTheme,
  renderMermaidDiagram
} from "./render";
import {
  DiagramRuleReason,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  evaluateDiagramFence
} from "./rules";

const RENDER_FAILURE_NOTICES: Record<DiagramRuleReason | "render" | "count", string> = {
  caption:
    "> ⚠️ The Mermaid diagram requires an immediately preceding **Diagram — …** caption.",
  size: "> ⚠️ The Mermaid diagram source exceeds the 20 KB limit.",
  kind:
    "> ⚠️ Unsupported Mermaid diagram kind (supported: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram).",
  count:
    "> ⚠️ A description accepts at most three Mermaid diagrams; this one was not rendered.",
  render: "> ⚠️ The Mermaid diagram could not be rendered."
};

const MARKDOWN_IMAGE_PATTERN =
  /!\[((?:\\.|[^\]])*)\]\(((?:\\.|[^\s)])+)(?:\s+((?:"(?:\\.|[^"])*")|'(?:\\.|[^'])*'))?\)/g;
const MARKDOWN_ALT_ESCAPE_PATTERN = /\\([[\]])/g;

function escapeAltText(caption: string): string {
  return caption.replace(/([[\]])/g, "\\$1");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * VS Code's native Markdown renderer supports a safe HTML subset, including
 * percentage image widths. Convert Markdown images to that subset so they
 * use the available width of comments and preview surfaces.
 */
export function makeRenderedImagesResponsive(markdown: string): string {
  const replaceImages = (content: string): string =>
    content.replace(
      MARKDOWN_IMAGE_PATTERN,
      (
        _,
        escapedAltText: string,
        escapedDestination: string,
        quotedTitle: string | undefined
      ) => {
        const altText = escapedAltText.replace(
          MARKDOWN_ALT_ESCAPE_PATTERN,
          "$1"
        );
        const destination = escapedDestination.replace(/\\([()\\])/g, "$1");
        const title = quotedTitle
          ? quotedTitle
              .slice(1, -1)
              .replace(/\\([\\"'])/g, "$1")
          : undefined;
        return (
          '<img alt="' +
          escapeHtmlAttribute(altText) +
          '" src="' +
          escapeHtmlAttribute(destination) +
          (title ? '" title="' + escapeHtmlAttribute(title) + '"' : '"') +
          ' width="100%">'
        );
      }
    );

  let fence: { character: string; length: number } | undefined;
  return markdown
    .split("\n")
    .map(line => {
      const marker = line.match(/^\s*([\x60]{3,}|~{3,})/);
      if (marker) {
        const character = marker[1][0];
        if (!fence) {
          fence = { character, length: marker[1].length };
        } else if (
          fence.character === character &&
          marker[1].length >= fence.length
        ) {
          fence = undefined;
        }
        return line;
      }

      return fence ? line : replaceImages(line);
    })
    .join("\n");
}

export async function renderDescription(
  description: string,
  theme: DescriptionTheme
): Promise<string> {
  const fences = findDiagramFences(description);
  if (fences.length === 0) {
    return description;
  }

  let content = description;
  for (let index = fences.length - 1; index >= 0; index--) {
    const fence = fences[index];
    let replacement: string;

    if (index >= MAX_DIAGRAMS_PER_DESCRIPTION) {
      replacement = RENDER_FAILURE_NOTICES.count;
    } else if (!fence.closed) {
      replacement = RENDER_FAILURE_NOTICES.render;
    } else {
      const evaluation = evaluateDiagramFence(fence);
      if (!evaluation.allowed) {
        replacement = RENDER_FAILURE_NOTICES[evaluation.reason];
      } else {
        try {
          const { png } = await renderMermaidDiagram(fence.source, theme);
          replacement = `![${escapeAltText(
            fence.caption!
          )}](data:image/png;base64,${png.toString("base64")})`;
        } catch {
          replacement = RENDER_FAILURE_NOTICES.render;
        }
      }
    }

    content =
      content.slice(0, fence.start) + replacement + content.slice(fence.end);
  }

  return content;
}
