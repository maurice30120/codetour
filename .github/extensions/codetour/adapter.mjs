import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI remains the sole owner of discovery, selection and rendering.
function command() {
  const configured = process.env.CODETOUR_CLI;
  if (configured) return resolveCommand(configured);
  const projectCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../dist/cli.js");
  if (existsSync(projectCli)) return [process.execPath, projectCli];
  if (process.platform === "win32") {
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      const launcher = path.join(directory || ".", "codetour.cmd");
      if (existsSync(launcher)) return resolveCommand(launcher);
    }
  }
  return ["codetour"];
}

function resolveCommand(configured) {
  if (configured.toLowerCase().endsWith(".js")) return [process.execPath, configured];
  if (configured.toLowerCase().endsWith(".cmd")) {
    // Distributions place the runtime and CLI beside codetour.cmd. Avoid a
    // shell entirely: paths and Tour titles remain individual arguments.
    const directory = path.dirname(path.resolve(configured));
    const runtime = path.join(directory, "node.exe");
    const cli = path.join(directory, "dist", "cli.js");
    if (!existsSync(runtime) || !existsSync(cli)) throw new Error("Configured .cmd is not a complete CodeTour distribution.");
    return [runtime, cli];
  }
  return [configured];
}

function parse(raw) {
  // The final token is the renderer flag when present; the remaining text is
  // the exact Tour title (including spaces), optionally enclosed in quotes.
  let text = (raw || "").trim();
  let renderer = "html";
  const match = text.match(/(?:^|\s)--renderer(?:=|\s+)([^\s]+)\s*$/);
  if (match) { renderer = match[1]; text = text.slice(0, match.index).trim(); }
  if (renderer !== "html" && renderer !== "terminal") throw new Error("Unknown renderer; use html or terminal.");
  if (/(?:^|\s)--/.test(text)) throw new Error("Unknown option. Use /codetour [tour] [--renderer html|terminal].");
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  return { title: text, renderer };
}

function runCli(args, cwd, { detached = false } = {}) {
  return new Promise((resolve, reject) => {
    const [executable, ...prefix] = command();
    const child = spawn(executable, [...prefix, ...args], {cwd, detached,
      stdio: detached ? "ignore" : ["ignore", "pipe", "pipe"], windowsHide: true});
    child.once("error", reject);
    if (detached) { child.once("spawn", () => { child.unref(); resolve(""); }); return; }
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `CodeTour exited ${code}`)));
  });
}

export async function runCodeTourCommand(session, raw, cwd = process.cwd()) {
  try {
    const { title, renderer } = parse(raw);
    const tours = JSON.parse(await runCli(["--internal-list-tours"], cwd));
    if (!tours.length) throw new Error("No existing Tours found in this Git worktree.");
    let selected;
    if (title) {
      const matches = tours.filter(tour => tour.title === title ||
        path.basename(fileURLToPath(tour.id), ".tour") === title);
      if (matches.length !== 1) throw new Error(`Tour '${title}' not found or ambiguous. Available: ${tours.map(t => t.title).join(", ")}`);
      selected = matches[0];
    } else if (tours.length === 1) selected = tours[0];
    else {
      if (!session.capabilities?.ui?.elicitation) throw new Error("Tour selection requires an interactive Copilot session; specify a Tour title.");
      const labels = tours.map((tour, i) => `${i + 1}. ${tour.title}`);
      const choice = await session.ui.select("Select a CodeTour", labels);
      if (choice === null || choice === undefined) return;
      selected = tours[labels.indexOf(choice)];
      if (!selected) throw new Error("Invalid Tour selection.");
    }
    await runCli(["--internal-tour-id", selected.id, "--renderer", renderer], cwd, {detached: true});
    await session.log(`Starting CodeTour: ${selected.title} (${renderer}).`, {level: "info"});
  } catch (error) {
    await session.log(`CodeTour: ${error instanceof Error ? error.message : String(error)}`, {level: "error"});
  }
}
