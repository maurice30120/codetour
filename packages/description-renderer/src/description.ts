import { findDiagramFences } from "./parse";
import {
  DescriptionTheme,
  renderMermaidDiagram
} from "./render";

const RENDER_FAILURE_NOTICE = "> ⚠️ The Mermaid diagram could not be rendered.";

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
  for (const fence of [...fences].reverse()) {
    let replacement: string;
    try {
      const { png } = await renderMermaidDiagram(fence.source, theme);
      replacement = `![${escapeAltText(fence.caption)}](data:image/png;base64,${png.toString(
        "base64"
      )})`;
    } catch {
      replacement = RENDER_FAILURE_NOTICE;
    }
    content =
      content.slice(0, fence.start) + replacement + content.slice(fence.end);
  }

  return content;
}
