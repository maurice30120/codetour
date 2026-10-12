// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Transforms the code fences of a preview description into Insert Code links.
// Mermaid fences are bypassed, so diagram sources are never offered as
// insertable code and never swallowed into another fence's payload.

const CODE_FENCE_PATTERN = /```[^\n]+\n(.+)\n```/gms;
const FENCE_OPEN_PATTERN = /^\s*```(.+)$/;
const FENCE_CLOSE_PATTERN = /^\s*```[ \t]*$/;
const MERMAID_FENCE_PATTERN = /^\s*```mermaid[ \t]*$/;

interface FenceSpan {
  openIndex: number;
  closeIndex: number;
  isMermaid: boolean;
}

function insertCodeLink(codeBlock: string): string {
  const params = encodeURIComponent(JSON.stringify([codeBlock]));
  return `↪ [Insert Code](command:codetour.insertCodeSnippet?${params} "Insert Code")`;
}

function transformLegacy(content: string): string {
  return content.replace(CODE_FENCE_PATTERN, (_, codeBlock) =>
    `${_}\n${insertCodeLink(codeBlock)}`
  );
}

function findFenceSpans(lines: string[]): FenceSpan[] {
  const spans: FenceSpan[] = [];

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

    spans.push({
      openIndex: index,
      closeIndex,
      isMermaid: MERMAID_FENCE_PATTERN.test(lines[index])
    });
    index = closeIndex + 1;
  }

  return spans;
}

function transformFenceRuns(content: string): string {
  const lines = content.split("\n");
  const spans = findFenceSpans(lines);

  const output: string[] = [];
  let cursor = 0;

  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    if (span.isMermaid) {
      continue;
    }

    let last = span;
    while (index + 1 < spans.length && !spans[index + 1].isMermaid) {
      index++;
      last = spans[index];
    }

    output.push(...lines.slice(cursor, span.openIndex));
    output.push(...lines.slice(span.openIndex, last.closeIndex + 1));
    output.push(
      insertCodeLink(lines.slice(span.openIndex + 1, last.closeIndex).join("\n"))
    );
    cursor = last.closeIndex + 1;
  }

  output.push(...lines.slice(cursor));
  return output.join("\n");
}

export function appendInsertCodeLinks(content: string): string {
  if (!content.includes("```mermaid")) {
    return transformLegacy(content);
  }

  return transformFenceRuns(content);
}
