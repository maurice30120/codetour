// CodeTour for Pi: intentionally a thin adapter over the existing MCP server.
// No copy of the generation prompt, no CodeGraph, and no second MCP client.

export function parseCodetourCommand(raw = "") {
  const input = String(raw ?? "").trim();
  if (input === "--help" || input === "help") return { help: true };
  const value = input.replace(/^generate(?:\s+|$)/i, "").trim();
  const match = /^(project|changes)(?:\s+|$)/i.exec(value);
  if (!match) return { type: null, reviewMode: null, request: value };
  const type = match[1].toLowerCase();
  let request = value.slice(match[0].length).trim();
  let reviewMode = null;
  if (type === "changes") {
    const mode = /^(neutral|critical)(?:\s+|$)/i.exec(request);
    if (mode) {
      reviewMode = mode[1].toLowerCase();
      request = request.slice(mode[0].length).trim();
    }
  }
  return { type, reviewMode, request };
}

export function buildGenerationMessage({ type, reviewMode, request }) {
  const input = {
    type,
    ...(type === "changes" ? { reviewMode } : {}),
    request,
  };
  const target = type === "project" ? "create_project_tour" : "create_changes_tour";
  return [
    "Generate a CodeTour in the current workspace using the existing CodeTour MCP server.",
    "FIRST call the MCP tool mcp__codetour__get_generation_prompt with these exact arguments:",
    JSON.stringify(input),
    "Follow the returned server-authored generation prompt in full, including its review, Knowledge, and validation requirements.",
    "Read the actual source code as instructed before calling mcp__codetour__" + target + ".",
    "Do not invent a fallback prompt, switch the requested mode, or claim persistence before the MCP creation tool confirms it.",
    "If the CodeTour MCP server or its prompt tool is unavailable, report the error and stop.",
  ].join("\n");
}

export default function codetourPiPlugin(pi) {
  // A Pi mcp.json declaration for 'codetour' overrides this registration.
  // Register on session start so the MCP workspace matches the active session.
  pi.on("session_start", (_event, ctx) => {
    const executable = process.env.CODETOUR_PI_EXECUTABLE?.trim() || "codetour";
    pi.registerMcpServer("codetour", {
      command: executable,
      args: ["mcp", "--workspace-root", ctx.cwd],
      description: "Create and validate CodeTour Project/Changes Tours and verified Knowledge.",
      exposure: "codemode",
      toolExposure: {
        get_generation_prompt: "direct",
        create_project_tour: "direct",
        create_changes_tour: "direct",
      },
    });
  });

  pi.registerCommand("codetour", {
    description: "Generate a CodeTour: /codetour generate project|changes [neutral|critical] [request]",
    handler: async (args, ctx) => {
      const parsed = parseCodetourCommand(args);
      if (parsed.help) {
        ctx.ui.notify("Usage: /codetour [generate] project [request] | changes [neutral|critical] [request]", "info");
        return;
      }

      let { type, reviewMode, request } = parsed;
      if (!type) {
        if (!ctx.hasUI) {
          pi.sendUserMessage(
            "The user requested a CodeTour" + (request ? " about " + JSON.stringify(request) : "") +
            ". Ask whether they want a Project Tour or a Changes Tour. Do not start generation until they choose."
          );
          return;
        }
        const chosen = await ctx.ui.select("CodeTour — tour type", ["Project Tour", "Changes Tour"]);
        if (!chosen) return; // Cancellation is not a generation request.
        type = chosen === "Project Tour" ? "project" : "changes";
      }

      if (type === "changes" && !reviewMode) {
        if (!ctx.hasUI) {
          pi.sendUserMessage(
            "The user requested a Changes Tour" + (request ? " about " + JSON.stringify(request) : "") +
            ". Ask them to choose neutral or critical review mode before generation."
          );
          return;
        }
        const mode = await ctx.ui.select("CodeTour — review mode", ["neutral", "critical"]);
        if (!mode) return;
        reviewMode = mode;
      }
      pi.sendUserMessage(buildGenerationMessage({ type, reviewMode, request }));
    },
  });
}
