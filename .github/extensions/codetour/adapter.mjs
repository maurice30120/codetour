import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The same command supplies playback, MCP tools and the offline review resource.
export function codeTourMcpServer(cwd = process.cwd()) {
  const [executable, ...prefix] = command();
  return {type: "stdio", command: executable, args: [...prefix, "mcp", "--workspace-root", cwd], tools: ["*"], workingDirectory: cwd};
}

// Single stdio MCP client for every generation this extension starts: the
// composed generation prompt served by codetour mcp through prompts/get.
// Timeout and errors are explicit; an empty or unreachable prompt rejects so
// no analysis can start. The adapter holds no prompt text: it passes the
// user's orientation phrase through and sends back what the server composed.
async function servedPrompt(cwd, name, args) {
  const config = codeTourMcpServer(cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args, {cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
    const lines = createInterface({input: child.stdout});
    let stderr = "";
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`CodeTour MCP prompt ${name} timed out.`)), 15000);
    const send = message => child.stdin.write(JSON.stringify({jsonrpc: "2.0", ...message}) + "\n");
    child.on("error", error => finish(error));
    child.stdin.on("error", error => finish(error));
    child.stderr.on("data", chunk => {stderr = (stderr + chunk).slice(-4096);});
    child.once("close", () => finish(new Error(stderr.trim() || `CodeTour MCP closed before serving ${name}.`)));
    lines.on("line", line => {
      try {
        const message = JSON.parse(line);
        if (message.error) throw new Error(message.error.message);
        if (message.id === 1) {
          send({method: "notifications/initialized"});
          send({id: 2, method: "prompts/get", params: {name, arguments: args}});
        } else if (message.id === 2) {
          const text = message.result?.messages?.map(item =>
            typeof item.content === "string" ? item.content : item.content?.text || "").join("\n");
          if (!text?.trim()) throw new Error(`CodeTour MCP returned an empty prompt for ${name}.`);
          finish(null, text);
        }
      } catch (error) { finish(error); }
    });
    send({id: 1, method: "initialize", params: {protocolVersion: "2024-11-05", capabilities: {}, clientInfo: {name: "codetour-copilot", version: "1.0.0"}}});
  });
}

// The CLI remains the sole owner of discovery, selection and rendering.
function command() {
  const configured = process.env.CODETOUR_CLI;
  if (configured) return resolveCommand(configured);
  const projectCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../dist/cli.js");
  if (existsSync(projectCli)) return ["node", projectCli];
  if (process.platform === "win32") {
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      const launcher = path.join(directory || ".", "codetour.cmd");
      if (existsSync(launcher)) return resolveCommand(launcher);
    }
  }
  return ["codetour"];
}

// Copilot can host extensions in its own native executable; process.execPath
// is then the Copilot CLI, not a Node interpreter. Development .js entries
// require Node on PATH. Packaged launchers use their bundled runtime.
function resolveCommand(configured) {
  if (configured.toLowerCase().endsWith(".js")) return ["node", configured];
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
  let renderer = "terminal";
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

// The adapter's only menu implementation: labels carry their number for the
// CLI, and the answer maps back through its index so the offered order stays
// the single source of truth. Returns the zero-based index, or null when the
// user cancels.
async function select(session, prompt, choices, unavailable = "This choice requires an interactive Copilot session; use /codetour generate project or /codetour generate changes neutral|critical, or specify a Tour title.") {
  if (!session.capabilities?.ui?.elicitation) throw new Error(unavailable);
  const labels = choices.map((label, index) => `${index + 1}. ${label}`);
  const answer = await session.ui.select(prompt, labels);
  if (answer === null || answer === undefined) return null;
  const index = labels.indexOf(answer);
  if (index < 0) throw new Error("Invalid CodeTour selection.");
  return index;
}

export async function runCodeTourCommand(session, raw, cwd = process.cwd()) {
  try {
    let input = (raw || "").trim();
    // generate [project|changes] [neutral|critical] followed by an optional
    // free phrase from the user: the Tour orientation, written in the user's
    // language. The phrase travels to the composed generation prompt as is;
    // the adapter interprets nothing in it.
    const explicit = input.match(/^generate(?:\s+(project|changes)(?:\s+(neutral|critical))?)?(?:\s+(\S.*))?$/);
    let action = explicit ? "Generate" : "Read";
    if (!input) {
      const choice = await select(session, "Read or generate a CodeTour?", ["Generate", "Read"]);
      if (choice === null) return;
      action = choice === 0 ? "Generate" : "Read";
    }
    if (action === "Generate") {
      let type = explicit?.[1];
      if (!type) {
        const choice = await select(session, "Which type of Tour?", ["Project Tour", "Changes Tour"]);
        if (choice === null) return;
        type = choice === 0 ? "project" : "changes";
      }
      let reviewMode = explicit?.[2];
      if (type === "project" && reviewMode) throw new Error("Project Tours do not have a review mode.");
      if (type === "changes" && !reviewMode) {
        const choice = await select(session, "Neutral or critical?", ["Neutral", "Critical"]);
        if (choice === null) return;
        reviewMode = choice === 0 ? "neutral" : "critical";
      }
      if (typeof session.send !== "function") throw new Error("This Copilot host cannot send a generation request to its agent.");
      let brief = (explicit?.[3] || "").trim();
      // A generation always asks for its orientation before launching: the
      // user can confirm or redirect the run while it is still free.
      // Cancelling stops the Tour instead of generating silently; an empty
      // answer keeps the standard prompt. A phrase already given in the
      // command is used as is and never asked again.
      if (!brief) {
        if (!session.capabilities?.ui?.elicitation) {
          throw new Error("Tour generation asks for its orientation before launching and needs an interactive Copilot session; provide it after the command: /codetour generate project|changes [neutral|critical] what the Tour should focus on.");
        }
        const answer = await session.ui.input("What should this Tour focus on? (empty for the standard Tour, cancel to stop)");
        if (answer === null || answer === undefined) return;
        brief = answer.trim();
      }
      // codetour mcp composes the generation prompt for this run, including
      // the user's orientation phrase and its language when one was given; the
      // adapter only relays the choices and the user's words.
      let prompt;
      try {
        prompt = await servedPrompt(
          cwd,
          type === "project" ? "generate_project_tour" : "generate_changes_tour",
          type === "project" ? (brief ? {brief} : {}) : {reviewMode, ...(brief ? {brief} : {})}
        );
      } catch (error) {
        // A bare spawn error would leave the user without the cause: name the
        // MCP server and the repair path.
        throw new Error(
          `CodeTour MCP server 'codetour' is unavailable: ${error instanceof Error ? error.message : String(error)} ` +
          "Run 'codetour --install copilot' and verify the server with 'copilot mcp list'."
        );
      }
      // The slash command has completed its choices; start the requested run now.
      // Enqueue leaves explicit commands waiting for another Enter on CLI 1.0.105.
      await session.send({prompt, mode: "immediate"});
      return;
    }
    const { title, renderer } = parse(input);
    // Selection is the CLI's resolution contract; host elicitation only picks
    // a candidate among many when no title is given. A given title keeps the
    // CLI resolution with its exact errors relayed as is (unique Tour
    // shortcut, ambiguity, empty workspace). An elicited candidate launches
    // the reader by identity, so duplicate titles resolve unambiguously.
    let selected;
    if (title) {
      selected = JSON.parse(await runCli(["--internal-resolve-tour", title], cwd));
    } else {
      const tours = JSON.parse(await runCli(["--internal-list-tours"], cwd));
      if (tours.length > 1) {
        const choice = await select(session, "Select a CodeTour", tours.map(tour => tour.title),
          "Tour selection requires an interactive Copilot session; specify a Tour title.");
        if (choice === null) return;
        const chosen = tours[choice];
        if (!chosen) throw new Error("Invalid Tour selection.");
        selected = chosen;
      } else {
        selected = JSON.parse(await runCli(["--internal-resolve-tour"], cwd));
      }
    }
    await runCli(["--internal-tour-id", selected.id, "--renderer", renderer], cwd, {detached: true});
    await session.log(`Starting CodeTour: ${selected.title} (${renderer}).`, {level: "info"});
  } catch (error) {
    await session.log(`CodeTour: ${error instanceof Error ? error.message : String(error)}`, {level: "error"});
  }
}
