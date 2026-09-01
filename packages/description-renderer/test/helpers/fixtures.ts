export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractPngDataUri(markdown: string, altText: string): Buffer {
  const pattern = new RegExp(
    `!\\[${escapeRegExp(altText)}\\]\\(data:image\\/png;base64,([A-Za-z0-9+/=]+)\\)`
  );
  const match = markdown.match(pattern);
  if (!match) {
    throw new Error(
      `Expected a PNG data URI image with alt text "${altText}" in:\n${markdown.slice(0, 400)}`
    );
  }
  return Buffer.from(match[1], "base64");
}

export function assertValidPng(png: Buffer): void {
  if (png.length < 200) {
    throw new Error(`Expected a non-trivial PNG, got ${png.length} bytes`);
  }
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Expected a PNG signature at the start of the image");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 20 || height < 20) {
    throw new Error(`Expected a visible diagram size, got ${width}x${height}`);
  }
  return void [width, height];
}

export const FLOWCHART_SOURCE = [
  "flowchart TD",
  "    Client --> Gateway --> Service",
  "    Service --> Database"
].join("\n");

export const CAPTIONED_FLOWCHART_DESCRIPTION = [
  "The request flows through three layers:",
  "",
  "**Diagram — Request lifecycle**",
  "",
  "```mermaid",
  FLOWCHART_SOURCE,
  "```",
  "",
  "That is the whole story."
].join("\n");
