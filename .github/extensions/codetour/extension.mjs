import { joinSession } from "@github/copilot-sdk/extension";
import { runCodeTourCommand } from "./adapter.mjs";

const session = await joinSession({commands: [{
  name: "codetour",
  description: "Open an existing CodeTour: /codetour [tour] [--renderer html|terminal]",
  handler: async ctx => runCodeTourCommand(session, ctx.args)
}]});
