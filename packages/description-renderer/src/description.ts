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

function escapeAltText(caption: string): string {
  return caption.replace(/([[\]])/g, "\\$1");
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
