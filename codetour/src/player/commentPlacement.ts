// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface SourceDocument {
  languageId: string;
  lineCount: number;
  lineAt(line: number): { text: string };
}

/** Native comment widgets appear below their range's final line. */
export function getCommentLineAbove(
  anchorLine: number,
  document: SourceDocument
): number {
  let start = Math.max(0, Math.min(anchorLine, document.lineCount - 1));

  // Keep C# attributes attached visually to the declaration they annotate.
  if (document.languageId === "csharp") {
    while (
      start > 0 &&
      /^\s*\[.*\]\s*(?:\/\/.*)?$/.test(document.lineAt(start - 1).text)
    ) {
      start--;
    }
  }

  // The native comments API cannot insert a widget before the first line.
  return Math.max(0, start - 1);
}
