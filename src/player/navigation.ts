/**
 * Appends comment navigation as separate Markdown blocks so each action can
 * wrap independently in the native VS Code comment widget.
 */
export function appendCommentNavigation(
  content: string,
  links: readonly string[]
): string {
  if (links.length === 0) {
    return content;
  }

  return `${content}\n\n---\n\n${links
    .map(link => `- ${link}`)
    .join("\n")}`;
}
