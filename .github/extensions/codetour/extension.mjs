import { joinSession } from "@github/copilot-sdk/extension";
import { runCodeTourCommand, generationTool } from "./adapter.mjs";

// The CodeTour MCP server is declared once, by the CodeTour plugin
// (`mcp.json`). The extension no longer joins a second server: doing so would
// expose two `codetour` servers (and two copies of every tool) in one session.
// The adapter still reaches the server over stdio for prompts/get.
const session = await joinSession({ commands: [{
  name: "codetour",
  description: "Read or generate a CodeTour: /codetour [tour] or /codetour generate project|changes [neutral|critical]",
  handler: async ctx => runCodeTourCommand(session, ctx.args)
}], tools: [generationTool({log: (...args) => session.log(...args)})] });
