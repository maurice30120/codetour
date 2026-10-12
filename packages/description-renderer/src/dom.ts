import { JSDOM } from "jsdom";
import {
  DEFAULT_FONT_SIZE,
  LINE_HEIGHT_FACTOR,
  measureTextWidth
} from "./measure";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const DOM_GLOBAL_KEYS = [
  "window",
  "self",
  "document",
  "navigator",
  "location",
  "history",
  "getComputedStyle",
  "DOMParser",
  "XMLSerializer",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "Image",
  "SVGElement",
  "MutationObserver",
  "CSSStyleDeclaration"
];

const NON_RENDERED_ELEMENTS = new Set([
  "defs",
  "style",
  "title",
  "desc",
  "metadata",
  "clipPath",
  "mask",
  "pattern",
  "symbol",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
  "script"
]);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

let environment: { window: DomWindow } | undefined;

export interface DomWindow {
  document: Document;
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
  SVGElement: typeof SVGElement;
  close(): void;
}

export function ensureDomEnvironment(): DomWindow {
  if (environment) {
    return environment.window;
  }

  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    pretendToBeVisual: false,
    url: "https://codetour.invalid/"
  });

  installSvgMeasurement(dom.window);

  environment = dom;

  const globals = globalThis as unknown as Record<string, unknown>;
  const domGlobals = dom.window as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBAL_KEYS) {
    if (domGlobals[key] === undefined) {
      continue;
    }
    Object.defineProperty(globals, key, {
      value: domGlobals[key],
      configurable: true,
      writable: true,
      enumerable: true
    });
  }

  return dom.window;
}

function installSvgMeasurement(window: DomWindow) {
  const prototype = window.SVGElement && window.SVGElement.prototype;
  if (!prototype) {
    return;
  }

  const svgPrototype = prototype as unknown as Record<string, unknown>;

  if (typeof svgPrototype.getBBox !== "function") {
    svgPrototype.getBBox = function(this: Element): Box {
      return measureElementBox(this);
    };
  }

  if (typeof svgPrototype.getComputedTextLength !== "function") {
    svgPrototype.getComputedTextLength = function(this: Element): number {
      return measureTextWidth(this.textContent || "", fontSizeOf(this));
    };
  }

  svgPrototype.getBoundingClientRect = function(this: Element) {
    const box = measureTextBox(this);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON() {
        return box;
      }
    };
  };
}

function coordinateOf(value: string | null, fontSize: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    return undefined;
  }
  if (value.trim().endsWith("em")) {
    return parsed * fontSize;
  }
  return parsed;
}

function fontSizeOf(element: Element): number {
  let current: Element | null = element;
  while (current) {
    const attribute = coordinateOf(current.getAttribute("font-size"), DEFAULT_FONT_SIZE);
    if (attribute !== undefined) {
      return attribute;
    }
    const style = current.getAttribute("style");
    if (style) {
      const match = style.match(/font-size:\s*([\d.]+)(px|em)?/);
      if (match) {
        const size = parseFloat(match[1]);
        return match[2] === "em" ? size * DEFAULT_FONT_SIZE : size;
      }
    }
    current = current.parentElement;
  }
  return DEFAULT_FONT_SIZE;
}

function measureTextBox(element: Element): Box {
  const fontSize = fontSizeOf(element);
  const x = coordinateOf(element.getAttribute("x"), fontSize) || 0;
  const tspans = Array.from(element.children).filter(
    child => child.localName === "tspan"
  );

  let width = 0;
  let top = Infinity;
  let bottom = -Infinity;

  const measureLine = (text: string, y: number) => {
    width = Math.max(width, measureTextWidth(text, fontSize));
    top = Math.min(top, y - fontSize * 0.85);
    bottom = Math.max(bottom, y + fontSize * 0.3);
  };

  if (tspans.length > 0) {
    let lineY = coordinateOf(element.getAttribute("y"), fontSize) || 0;
    for (const tspan of tspans) {
      const explicitY = coordinateOf(tspan.getAttribute("y"), fontSize);
      const dy = coordinateOf(tspan.getAttribute("dy"), fontSize);
      if (explicitY !== undefined) {
        lineY = explicitY;
      } else if (dy !== undefined) {
        lineY += dy;
      } else {
        lineY += fontSize * LINE_HEIGHT_FACTOR;
      }
      measureLine(tspan.textContent || "", lineY);
    }
  } else {
    measureLine(
      element.textContent || "",
      coordinateOf(element.getAttribute("y"), fontSize) || 0
    );
  }

  if (top === Infinity) {
    top = -fontSize;
    bottom = fontSize * 0.3;
  }

  return {
    x,
    y: top,
    width,
    height: Math.max(bottom - top, fontSize * LINE_HEIGHT_FACTOR)
  };
}

function union(boxes: Box[]): Box {
  const minX = Math.min(...boxes.map(box => box.x));
  const minY = Math.min(...boxes.map(box => box.y));
  const maxX = Math.max(...boxes.map(box => box.x + box.width));
  const maxY = Math.max(...boxes.map(box => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function multiplyMatrices(first: Matrix, second: Matrix): Matrix {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f
  };
}

function parseTransform(value: string | null): Matrix {
  if (!value) {
    return IDENTITY;
  }

  let result = IDENTITY;
  const pattern = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const args = match[2]
      .split(/[\s,]+/)
      .map(Number)
      .filter(number => !isNaN(number));

    let transform: Matrix;
    if (match[1] === "translate") {
      transform = { a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 };
    } else if (match[1] === "scale") {
      const scaleX = args[0] === undefined ? 1 : args[0];
      const scaleY = args[1] === undefined ? scaleX : args[1];
      transform = { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
    } else if (match[1] === "rotate") {
      const angle = ((args[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (args.length > 2) {
        transform = multiplyMatrices(
          multiplyMatrices({ a: 1, b: 0, c: 0, d: 1, e: args[1], f: args[2] }, rotation),
          { a: 1, b: 0, c: 0, d: 1, e: -args[1], f: -args[2] }
        );
      } else {
        transform = rotation;
      }
    } else {
      transform = {
        a: args[0] || 1,
        b: args[1] || 0,
        c: args[2] || 0,
        d: args[3] || 1,
        e: args[4] || 0,
        f: args[5] || 0
      };
    }

    result = multiplyMatrices(result, transform);
  }

  return result;
}

function transformBox(box: Box, matrix: Matrix): Box {
  const points = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height }
  ].map(point => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  }));

  return union(points.map(point => ({ ...point, width: 0, height: 0 })));
}

function measureElementBox(element: Element, inherited: Matrix = IDENTITY): Box {
  const matrix = multiplyMatrices(
    inherited,
    parseTransform(element.getAttribute("transform"))
  );

  const tag = element.localName;

  if (tag === "text" || tag === "tspan") {
    return transformBox(measureTextBox(element), matrix);
  }

  if (tag === "rect") {
    return transformBox(
      {
        x: coordinateOf(element.getAttribute("x"), DEFAULT_FONT_SIZE) || 0,
        y: coordinateOf(element.getAttribute("y"), DEFAULT_FONT_SIZE) || 0,
        width: coordinateOf(element.getAttribute("width"), DEFAULT_FONT_SIZE) || 0,
        height: coordinateOf(element.getAttribute("height"), DEFAULT_FONT_SIZE) || 0
      },
      matrix
    );
  }

  if (tag === "circle") {
    const r = coordinateOf(element.getAttribute("r"), DEFAULT_FONT_SIZE) || 0;
    const cx = coordinateOf(element.getAttribute("cx"), DEFAULT_FONT_SIZE) || 0;
    const cy = coordinateOf(element.getAttribute("cy"), DEFAULT_FONT_SIZE) || 0;
    return transformBox({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, matrix);
  }

  if (tag === "ellipse") {
    const rx = coordinateOf(element.getAttribute("rx"), DEFAULT_FONT_SIZE) || 0;
    const ry = coordinateOf(element.getAttribute("ry"), DEFAULT_FONT_SIZE) || 0;
    const cx = coordinateOf(element.getAttribute("cx"), DEFAULT_FONT_SIZE) || 0;
    const cy = coordinateOf(element.getAttribute("cy"), DEFAULT_FONT_SIZE) || 0;
    return transformBox({ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }, matrix);
  }

  if (tag === "line") {
    const x1 = coordinateOf(element.getAttribute("x1"), DEFAULT_FONT_SIZE) || 0;
    const y1 = coordinateOf(element.getAttribute("y1"), DEFAULT_FONT_SIZE) || 0;
    const x2 = coordinateOf(element.getAttribute("x2"), DEFAULT_FONT_SIZE) || 0;
    const y2 = coordinateOf(element.getAttribute("y2"), DEFAULT_FONT_SIZE) || 0;
    return transformBox(
      union([
        { x: x1, y: y1, width: 0, height: 0 },
        { x: x2, y: y2, width: 0, height: 0 }
      ]),
      matrix
    );
  }

  if (tag === "path") {
    return pathBox(element, matrix);
  }

  const boxes = Array.from(element.children)
    .filter(child => !NON_RENDERED_ELEMENTS.has(child.localName))
    .map(child => measureElementBox(child, matrix));
  if (boxes.length === 0) {
    return transformBox({ x: 0, y: 0, width: 0, height: 0 }, matrix);
  }
  return union(boxes);
}

function pathBox(element: Element, matrix: Matrix): Box {
  const commands = element.getAttribute("d") || "";
  const pattern = /([MLCQTAZmlcqtaz])([^MLCQTAZmlcqtaz]*)/g;
  let currentX = 0;
  let currentY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const track = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commands))) {
    const command = match[1];
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(part => part !== "")
      .map(Number)
      .filter(number => !isNaN(number));

    if (command === "M" || command === "L" || command === "T") {
      for (let index = 0; index + 1 < args.length; index += 2) {
        currentX = args[index];
        currentY = args[index + 1];
        track(currentX, currentY);
      }
    } else if (command === "m" || command === "l" || command === "t") {
      for (let index = 0; index + 1 < args.length; index += 2) {
        currentX += args[index];
        currentY += args[index + 1];
        track(currentX, currentY);
      }
    } else if (command === "C") {
      for (let index = 0; index + 5 < args.length; index += 6) {
        track(args[index], args[index + 1]);
        track(args[index + 2], args[index + 3]);
        currentX = args[index + 4];
        currentY = args[index + 5];
        track(currentX, currentY);
      }
    } else if (command === "c") {
      for (let index = 0; index + 5 < args.length; index += 6) {
        track(currentX + args[index], currentY + args[index + 1]);
        track(currentX + args[index + 2], currentY + args[index + 3]);
        currentX += args[index + 4];
        currentY += args[index + 5];
        track(currentX, currentY);
      }
    } else if (command === "Q" || command === "S") {
      for (let index = 0; index + 3 < args.length; index += 4) {
        track(args[index], args[index + 1]);
        currentX = args[index + 2];
        currentY = args[index + 3];
        track(currentX, currentY);
      }
    } else if (command === "q" || command === "s") {
      for (let index = 0; index + 3 < args.length; index += 4) {
        track(currentX + args[index], currentY + args[index + 1]);
        currentX += args[index + 2];
        currentY += args[index + 3];
        track(currentX, currentY);
      }
    } else if (command === "H") {
      for (const value of args) {
        currentX = value;
        track(currentX, currentY);
      }
    } else if (command === "h") {
      for (const value of args) {
        currentX += value;
        track(currentX, currentY);
      }
    } else if (command === "V") {
      for (const value of args) {
        currentY = value;
        track(currentX, currentY);
      }
    } else if (command === "v") {
      for (const value of args) {
        currentY += value;
        track(currentX, currentY);
      }
    } else if (command === "A") {
      for (let index = 5; index < args.length; index += 7) {
        currentX = args[index];
        currentY = args[index + 1];
        track(currentX, currentY);
      }
    } else if (command === "a") {
      for (let index = 5; index < args.length; index += 7) {
        currentX += args[index];
        currentY += args[index + 1];
        track(currentX, currentY);
      }
    }
  }

  if (minX === Infinity) {
    return transformBox({ x: 0, y: 0, width: 0, height: 0 }, matrix);
  }

  return transformBox(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    matrix
  );
}

export function measureContentBounds(root: Element): Box {
  const boxes = Array.from(root.children)
    .filter(child => !NON_RENDERED_ELEMENTS.has(child.localName))
    .map(child => measureElementBox(child));
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return union(boxes);
}

export function parseSvgDocument(svg: string): Document {
  const window = ensureDomEnvironment();
  const document = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.documentElement.localName !== "svg") {
    throw new Error("The rendered diagram is not a valid SVG document");
  }
  return document;
}

export function serializeSvgDocument(document: Document): string {
  const window = ensureDomEnvironment();
  return new window.XMLSerializer().serializeToString(document.documentElement);
}

export { SVG_NAMESPACE };
