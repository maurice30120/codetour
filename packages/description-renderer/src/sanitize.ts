import { parseSvgDocument, serializeSvgDocument } from "./dom";

const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "use",
  "link",
  "meta",
  "base"
]);

const BLOCKED_ATTRIBUTE_PATTERN = /^on/i;
const DANGEROUS_HREF_PATTERN = /^(javascript|data:text\/html|vbscript)/i;

function sanitizeElement(element: Element): void {
  for (const child of Array.from(element.children)) {
    if (child.localName === "a") {
      sanitizeElement(child);
      for (const grandChild of Array.from(child.children)) {
        element.insertBefore(grandChild, child);
      }
      element.removeChild(child);
    } else if (BLOCKED_ELEMENTS.has(child.localName)) {
      element.removeChild(child);
    } else {
      sanitizeElement(child);
    }
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name;
    if (BLOCKED_ATTRIBUTE_PATTERN.test(name)) {
      element.removeAttribute(name);
      continue;
    }

    if (
      (name === "href" || name === "xlink:href") &&
      DANGEROUS_HREF_PATTERN.test(attribute.value.trim())
    ) {
      element.removeAttribute(name);
    }
  }
}

export function sanitizeSvg(svg: string): string {
  const document = parseSvgDocument(svg);
  sanitizeElement(document.documentElement);
  return serializeSvgDocument(document);
}
