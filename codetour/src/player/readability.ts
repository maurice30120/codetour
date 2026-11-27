// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt = require("markdown-it");

const markdown = new MarkdownIt({ html: true });

/** Separates standalone image lines from adjacent prose without changing code. */
export function spaceDescriptionImages(content: string): string {
  const lines = content.split("\n");
  const breaks = new Set<number>();

  for (const token of markdown.parse(content, {})) {
    if (token.type !== "inline" || token.level !== 1 || !token.map) continue;
    for (let line = token.map[0]; line < token.map[1]; line++) {
      const children = markdown.parseInline(lines[line], {})[0]?.children || [];
      const visible = children.filter(child => child.type !== "text" || child.content.trim());
      if (visible.length !== 1 || visible[0].type !== "image") continue;

      if (line > 0 && lines[line - 1].trim()) breaks.add(line);
      if (line + 1 < lines.length && lines[line + 1].trim()) breaks.add(line + 1);
    }
  }

  return lines
    .flatMap((line, index) => breaks.has(index) ? ["", line] : [line])
    .join("\n");
}

/** Adds breathing room to top-level lists on native Markdown playback surfaces. */
export function spaceDescriptionLists(content: string): string {
  const lines = content.split("\n");
  const breaks = new Set<number>();
  const tokens = markdown.parse(content, {});

  tokens.forEach((token, index) => {
    if (token.type !== "list_item_open" || token.level !== 1 || !token.map) {
      return;
    }

    const previous = tokens[index - 1];
    const line = token.map[0];
    if (
      previous?.type !== "bullet_list_open" &&
      previous?.type !== "ordered_list_open" &&
      line > 0 &&
      lines[line - 1].trim() !== ""
    ) {
      breaks.add(line);
    }
  });

  return lines
    .flatMap((line, index) => breaks.has(index) ? ["", line] : [line])
    .join("\n");
}
