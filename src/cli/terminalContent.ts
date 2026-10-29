import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  evaluateDiagramFence,
  findDiagramFences,
  findLocalImageReferences,
  imageMimeType,
  MAX_DIAGRAMS_PER_DESCRIPTION,
  renderDescription,
  renderMermaidDiagram
} from "codetour-description-renderer";
import { renderMarkdownToHtml } from "../player/markdown";
import type { CodeTour, CodeTourStep } from "../store";

/**
 * Fail the entire terminal Tour on the reached step, never prevalidate future
 * steps or quietly replace unsupported content with plain text/HTML.
 */
export class TerminalStepRenderError extends Error {
  constructor(tour: CodeTour, index: number, contentType: string, reason: string) {
    super("CodeTour terminal stopped: Tour '" + tour.title + "', step " +
      (index + 1) + " ('" + (tour.steps[index]?.title || "Untitled") + "'), " +
      contentType + ": " + reason);
    this.name = "TerminalStepRenderError";
  }
}

export async function renderTerminalDescription(
  tour: CodeTour,
  index: number,
  root: string
): Promise<string> {
  const step: CodeTourStep = tour.steps[index];
  if (!step) throw new TerminalStepRenderError(tour, index, "step", "does not exist");

  const fail = (kind: string, message: string): never => {
    throw new TerminalStepRenderError(tour, index, kind, message);
  };
  const source = step.description || "";

  // Author CSS and interactive DOM elements cannot be safely preserved by the
  // existing sanitizer; fail rather than silently stripping them in the POC.
  if (/<(?:script|style|iframe|embed|object|svg|canvas)\b|\sstyle\s*=/i.test(source)) {
    fail("HTML/CSS", "unsupported interactive or styled markup");
  }

  const fences = findDiagramFences(source);
  if (fences.length > MAX_DIAGRAMS_PER_DESCRIPTION) {
    fail("Mermaid", "more than " + MAX_DIAGRAMS_PER_DESCRIPTION + " diagrams");
  }
  for (const fence of fences) {
    if (!fence.closed) fail("Mermaid", "diagram code fence is not closed");
    const evaluation = evaluateDiagramFence(fence);
    if (!evaluation.allowed) {
      fail("Mermaid", "diagram violates existing CodeTour rules: " + evaluation.reason);
    }
    try {
      await renderMermaidDiagram(fence.source, "dark");
    } catch (error) {
      fail("Mermaid", "rasterization failed: " +
        (error instanceof Error ? error.message : String(error)));
    }
  }

  const localImages = new Map<string, Uint8Array>();
  for (const ref of findLocalImageReferences(source)) {
    const imagePath = ref.path;
    if (path.isAbsolute(imagePath) || imagePath.split(/[\\/]/).includes("..")) {
      fail("image", "unsafe path: " + imagePath);
    }
    try {
      const absolute = path.resolve(root, imagePath);
      const bytes = await readFile(absolute);
      if (!imageMimeType(bytes)) fail("image", "not a supported PNG/JPEG: " + imagePath);
      if (bytes.length > 2 * 1024 * 1024) fail("image", "exceeds 2 MB: " + imagePath);
      localImages.set(imagePath, bytes);
    } catch (error) {
      if (error instanceof TerminalStepRenderError) throw error;
      fail("image", "cannot read " + imagePath + ": " +
        (error instanceof Error ? error.message : String(error)));
    }
  }
  try {
    const rendered = await renderDescription(source, "dark", {
      resolveImageBytes: imagePath => localImages.get(imagePath)
    });
    if (/⚠️ The Mermaid diagram|⚠️ The referenced image/.test(rendered)) {
      fail("rich content", "the shared renderer reported unsupported content");
    }
    return renderMarkdownToHtml(rendered);
  } catch (error) {
    if (error instanceof TerminalStepRenderError) throw error;
    return fail("rich content", error instanceof Error ? error.message : String(error));
  }
}
