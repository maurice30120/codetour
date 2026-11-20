import test from "node:test";
import assert from "node:assert/strict";
import activate, { parseCodetourCommand, buildGenerationMessage } from "./index.mjs";

function harness() {
  const events = new Map(), commands = new Map(), servers = [], messages = [];
  const pi = {
    on: (name, handler) => events.set(name, handler),
    registerCommand: (name, registration) => commands.set(name, registration),
    registerMcpServer: (name, config) => servers.push({ name, config }),
    sendUserMessage: (message) => messages.push(message),
  };
  activate(pi);
  return { events, commands, servers, messages };
}

test("parses project and Changes Tour options without swallowing the user's words", () => {
  assert.deepEqual(parseCodetourCommand("generate project montre-moi le login"), {
    type: "project", reviewMode: null, request: "montre-moi le login",
  });
  assert.deepEqual(parseCodetourCommand("changes critical vérifier les appels"), {
    type: "changes", reviewMode: "critical", request: "vérifier les appels",
  });
  assert.deepEqual(parseCodetourCommand("generate changes neutral"), {
    type: "changes", reviewMode: "neutral", request: "",
  });
  assert.deepEqual(parseCodetourCommand("générer login"), {
    type: null, reviewMode: null, request: "générer login",
  });
});

test("registers the existing MCP as one workspace-scoped server", () => {
  const h = harness();
  const old = process.env.CODETOUR_PI_EXECUTABLE;
  process.env.CODETOUR_PI_EXECUTABLE = "/opt/CodeTour with spaces/codetour";
  try {
    h.events.get("session_start")({}, { cwd: "/tmp/project with spaces" });
    assert.equal(h.servers.length, 1);
    assert.equal(h.servers[0].name, "codetour");
    assert.deepEqual(h.servers[0].config.args, ["mcp", "--workspace-root", "/tmp/project with spaces"]);
    assert.equal(h.servers[0].config.command, "/opt/CodeTour with spaces/codetour");
    assert.equal(h.servers[0].config.exposure, "codemode");
    assert.equal(h.servers[0].config.toolExposure.get_generation_prompt, "direct");
  } finally {
    if (old === undefined) delete process.env.CODETOUR_PI_EXECUTABLE;
    else process.env.CODETOUR_PI_EXECUTABLE = old;
  }
});

test("explicit project command sends a request for the server-owned prompt", async () => {
  const h = harness();
  await h.commands.get("codetour").handler("generate project architecture auth", { hasUI: false });
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0], /mcp__codetour__get_generation_prompt/);
  assert.match(h.messages[0], /"type":"project"/);
  assert.match(h.messages[0], /"request":"architecture auth"/);
  assert.match(h.messages[0], /mcp__codetour__create_project_tour/);
});

test("critical changes command retains mode and request", async () => {
  const h = harness();
  await h.commands.get("codetour").handler("changes critical ma branche", { hasUI: false });
  assert.match(h.messages[0], /"reviewMode":"critical"/);
  assert.match(h.messages[0], /"request":"ma branche"/);
  assert.match(h.messages[0], /mcp__codetour__create_changes_tour/);
});

test("no-argument UI dialogue and cancellation do not manufacture a Tour", async () => {
  const h = harness();
  const selected = ["Changes Tour", "critical"];
  const ctx = { hasUI: true, ui: { select: async () => selected.shift() } };
  await h.commands.get("codetour").handler("", ctx);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0], /"reviewMode":"critical"/);
  const cancelled = harness();
  await cancelled.commands.get("codetour").handler("", {
    hasUI: true, ui: { select: async () => undefined },
  });
  assert.deepEqual(cancelled.messages, []);
});

test("headless ambiguous requests ask for missing choices, not start generation", async () => {
  const h = harness();
  await h.commands.get("codetour").handler("generate", { hasUI: false });
  assert.match(h.messages[0], /Ask whether/);
  assert.doesNotMatch(h.messages[0], /get_generation_prompt/);
  await h.commands.get("codetour").handler("changes", { hasUI: false });
  assert.match(h.messages[1], /neutral or critical/);
  assert.doesNotMatch(h.messages[1], /get_generation_prompt/);
});

test("server prompt remains the only generation method", () => {
  const prompt = buildGenerationMessage({ type: "changes", reviewMode: "neutral", request: "review" });
  assert.match(prompt, /FIRST call/);
  assert.match(prompt, /server-authored generation prompt/);
  assert.match(prompt, /Do not invent a fallback prompt/);
});
