const NARROW_CHARACTERS = new Set([
  "i",
  "I",
  "l",
  "j",
  "t",
  "f",
  ".",
  ",",
  ":",
  ";",
  "'",
  "`",
  "|",
  "!",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "/",
  "\\",
  "-"
]);

const WIDE_CHARACTERS = new Set(["m", "M", "w", "W", "@", "%", "&"]);

export const DEFAULT_FONT_SIZE = 16;
export const LINE_HEIGHT_FACTOR = 1.25;

function characterWidthFactor(character: string): number {
  if (character === " ") {
    return 0.3;
  }
  if (character === "\t") {
    return 1.2;
  }
  if (NARROW_CHARACTERS.has(character)) {
    return 0.32;
  }
  if (WIDE_CHARACTERS.has(character)) {
    return 0.95;
  }
  if (character >= "A" && character <= "Z") {
    return 0.72;
  }
  if (character >= "0" && character <= "9") {
    return 0.58;
  }
  if (character === "—" || character === "–") {
    return 1;
  }
  if (character.charCodeAt(0) > 0x2000) {
    return 1;
  }
  return 0.55;
}

export function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const character of text) {
    width += characterWidthFactor(character);
  }
  return width * fontSize;
}
