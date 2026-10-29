import type { CodeTour } from "../store";
import { renderMarkdownToHtml, escapeHtml } from "../player/markdown";

/**
 * The renderer runs in a dedicated terminal process. Only TermDOM owns the
 * terminal DOM and input; CodeTour keeps the step state in this process.
 */
export function runTerminalTour(tour: CodeTour): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("TermDOM requires an interactive terminal (TTY).");
  }
  // Required lazily: plain HTML reading must work without a terminal host.
  // The package is kept external to the VS Code extension bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TermDOM } = require("@b9g/termdom") as {
    TermDOM: new (options?: Record<string, unknown>) => {
      attach(): void;
      document: Document;
      window: Window & { close(): void; scrollBy(x: number, y: number): void };
    };
  };
  const term = new TermDOM({
    scripting: "none",
    ptyEmbeds: "none",
    csp: "default-src 'none'; img-src data: https:",
    onError: "throw"
  });
  term.attach();

  const { document, window } = term;
  const css = document.createElement("style");
  css.textContent = [
    "body { padding: 1ch 2ch 4ch; color: #ededed; background-color: #161b22; }",
    ".header { position: fixed; top: 0; left: 0; width: 100%; background-color: #202b38; color: #9bd8ff; }",
    ".footer { position: fixed; bottom: 0; left: 0; width: 100%; background-color: #202b38; color: #c6c6c6; }",
    ".content { padding-top: 2ch; }",
    "h1 { color: #80cbff; font-weight: bold; }",
    "h2 { color: #dad08c; }",
    "a { color: #71bdff; }",
    "pre { background-color: #101419; padding: 1ch; }",
    "blockquote { border-left: 1px solid #808080; padding-left: 1ch; }",
    "table { margin: 1ch 0; }",
    ".anchor { color: #a6a6a6; }",
    "button { color: #ffffff; background-color: #234662; padding: 0 1ch; }"
  ].join("\n");
  document.head.appendChild(css);

  const header = document.createElement("header");
  header.className = "header";
  const article = document.createElement("article");
  article.className = "content";
  const footer = document.createElement("footer");
  footer.className = "footer";
  document.body.append(header, article, footer);

  let current = 0;
  let finished = false;
  function render(): void {
    if (finished) return;
    const step = tour.steps[current];
    if (!step) {
      article.textContent = "This Tour has no steps.";
      return;
    }
    header.textContent = tour.title + " · " + (current + 1) + "/" + tour.steps.length;
    const anchor = step.file || step.uri || step.directory || step.view || "";
    const label = anchor ? '<p class="anchor">' + escapeHtml(anchor) +
      (step.line ? ":" + step.line : "") + "</p>" : "";
    article.innerHTML = "<h1>" + escapeHtml(step.title || "Step " + (current + 1)) +
      "</h1>" + label + renderMarkdownToHtml(step.description);
    footer.textContent = "←/→ previous/next · j/k scroll · PgUp/PgDn page · q finish";
    window.scrollBy(0, -document.body.scrollHeight);
  }
  function close(): void {
    finished = true;
    term.window.close();
  }
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const key = event.key;
    if (key === "q" || key === "Escape") close();
    else if ((key === "ArrowRight" || key === "n") && current < tour.steps.length - 1) {
      current++; render();
    } else if ((key === "ArrowLeft" || key === "p") && current > 0) {
      current--; render();
    } else if (key === "j" || key === "ArrowDown") window.scrollBy(0, 1);
    else if (key === "k" || key === "ArrowUp") window.scrollBy(0, -1);
    else if (key === "PageDown" || key === " ") window.scrollBy(0, Math.max(1, window.innerHeight - 3));
    else if (key === "PageUp") window.scrollBy(0, -Math.max(1, window.innerHeight - 3));
    else return;
    event.preventDefault();
  });
  if (!tour.steps.length) {
    header.textContent = tour.title;
    article.textContent = "Tour has no steps. Press q to quit.";
    footer.textContent = "q finish";
  } else {
    render();
  }
}
