const MERMAID_FENCE_PATTERN = /^(\s*)```mermaid[ \t]*$/;
const FENCE_CLOSE_PATTERN = /^\s*```[ \t]*$/;
const FENCE_OPEN_PATTERN = /^\s*```/;
const CAPTION_PATTERN = /^\s*\*\*(Diagram — .+?)\*\*[ \t]*$/;

export interface DiagramFence {
  caption: string;
  source: string;
  start: number;
  end: number;
}

function findCaption(lines: string[], fenceIndex: number): string | undefined {
  for (let index = fenceIndex - 1; index >= 0; index--) {
    const line = lines[index];
    if (line.trim() === "") {
      continue;
    }
    const match = line.match(CAPTION_PATTERN);
    return match ? match[1].trim() : undefined;
  }
  return undefined;
}

export function findDiagramFences(description: string): DiagramFence[] {
  const lines = description.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const fences: DiagramFence[] = [];

  let index = 0;
  while (index < lines.length) {
    if (!FENCE_OPEN_PATTERN.test(lines[index])) {
      index++;
      continue;
    }

    let closeIndex = -1;
    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (FENCE_CLOSE_PATTERN.test(lines[candidate])) {
        closeIndex = candidate;
        break;
      }
    }

    if (closeIndex === -1) {
      break;
    }

    if (MERMAID_FENCE_PATTERN.test(lines[index])) {
      const caption = findCaption(lines, index);
      if (caption) {
        fences.push({
          caption,
          source: lines.slice(index + 1, closeIndex).join("\n"),
          start: lineOffsets[index],
          end: lineOffsets[closeIndex] + lines[closeIndex].length
        });
      }
    }

    index = closeIndex + 1;
  }

  return fences;
}
