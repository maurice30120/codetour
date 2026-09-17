import { isMermaidFenceInfo, matchDiagramCaption } from "./rules";

const FENCE_INFO_PATTERN = /^\s*```(.*)$/;
const FENCE_CLOSE_PATTERN = /^\s*```[ \t]*$/;
const FENCE_OPEN_PATTERN = /^\s*```/;

export interface DiagramFence {
  caption?: string;
  source: string;
  closed: boolean;
  start: number;
  end: number;
}

function findCaption(lines: string[], fenceIndex: number): string | undefined {
  for (let index = fenceIndex - 1; index >= 0; index--) {
    const line = lines[index];
    if (line.trim() === "") {
      continue;
    }
    return matchDiagramCaption(line);
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
      const infoMatch = lines[index].match(FENCE_INFO_PATTERN);
      if (infoMatch && isMermaidFenceInfo(infoMatch[1])) {
        fences.push({
          caption: findCaption(lines, index),
          source: lines.slice(index + 1).join("\n"),
          closed: false,
          start: lineOffsets[index],
          end: description.length
        });
      }
      break;
    }

    const infoMatch = lines[index].match(FENCE_INFO_PATTERN);
    if (infoMatch && isMermaidFenceInfo(infoMatch[1])) {
      fences.push({
        caption: findCaption(lines, index),
        source: lines.slice(index + 1, closeIndex).join("\n"),
        closed: true,
        start: lineOffsets[index],
        end: lineOffsets[closeIndex] + lines[closeIndex].length
      });
    }

    index = closeIndex + 1;
  }

  return fences;
}
