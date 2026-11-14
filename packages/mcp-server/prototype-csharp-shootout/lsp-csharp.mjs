// PROTOTYPE — S3 spike (throwaway): csharp-ls (Roslyn-based LSP) over the C#
// fixtures. Measures what a precision plugin would give on top of / instead
// of the rule pack: references (usages de classe + appelants),
// call hierarchy when supported. Writes lsp-result.json consumed by
// shootout.mjs.

import { spawn } from "node:child_process";
import { encode } from "gpt-tokenizer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "fixture/csharp");
const serverBin = path.join(os.homedir(), ".dotnet/tools/csharp-ls");
const WINDOW = 8;

const tokens = (text) => encode(text).length;

const child = spawn(serverBin, [], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });

let buffer = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString();
    const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
    if (Number.isNaN(length)) return;
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString();
    buffer = buffer.subarray(start + length);
    const message = JSON.parse(body);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

function send(message) {
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function request(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

const relative = (targetUri) => path.relative(root, fileURLToPath(targetUri)).split(path.sep).join("/");

const csFiles = {};
async function openFiles() {
  for (const dir of ["Models", "Services", "Api"]) {
    const entries = await fs.readdir(path.join(root, dir));
    for (const name of entries) {
      if (!name.endsWith(".cs")) continue;
      const full = path.join(root, dir, name);
      const text = await fs.readFile(full, "utf8");
      csFiles[`${dir}/${name}`] = text;
      send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: pathToFileURL(full).href, languageId: "csharp", version: 1, text } },
      });
    }
  }
}

/** Find (line, character) of a declaration by text search — server-agnostic. */
function findPosition(file, needle, occurrence = 1) {
  const text = csFiles[file];
  if (!text) throw new Error(`file not found: ${file}`);
  const lines = text.split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    const at = lines[index].indexOf(needle);
    if (at !== -1) {
      seen += 1;
      if (seen === occurrence) return { line: index, character: at };
    }
  }
  throw new Error(`${needle} not found in ${file}`);
}

/** Position ON the type name of `class X` / `interface X`, never on the keyword or a comment. */
function findTypePosition(file, typeNeedle) {
  const base = findPosition(file, typeNeedle);
  const prefixLength = typeNeedle.split(" ")[0].length + 1;
  return { line: base.line, character: base.character + prefixLength };
}

const uriOf = (file) => pathToFileURL(path.join(root, file)).href;

async function referencesAt(file, position) {
  const started = Date.now();
  const refs = await request("textDocument/references", {
    textDocument: { uri: uriOf(file) },
    position,
    context: { includeDeclaration: true },
  });
  return {
    durationMs: Date.now() - started,
    locations: (refs ?? []).map((ref) => ({
      file: relative(ref.uri),
      line: ref.range.start.line + 1,
      kind: ref.kind,
    })),
  };
}

function needlePosition(file, needle, occurrence = 1) {
  return findPosition(file, needle, occurrence);
}

async function references(file, needle, occurrence = 1) {
  const position = needlePosition(file, needle, occurrence);
  return referencesAt(file, position);
}

async function callHierarchy(file, needle, occurrence = 1) {
  const position = findPosition(file, needle, occurrence);
  const prepared = await request("textDocument/prepareCallHierarchy", {
    textDocument: { uri: uriOf(file) },
    position,
  });
  if (!prepared || prepared.length === 0) return { supported: true, empty: true };
  const item = prepared[0];
  const incoming = await request("callHierarchy/incomingCalls", { item });
  const outgoing = await request("callHierarchy/outgoingCalls", { item });
  return {
    supported: true,
    incoming: incoming.map((entry) => ({
      name: entry.from.name,
      file: relative(entry.from.uri),
      line: entry.from.range.start.line + 1,
    })),
    outgoing: outgoing.map((entry) => ({
      name: entry.to.name,
      file: relative(entry.to.uri),
      line: entry.to.selectionRange?.start.line + 1 ?? entry.to.range.start.line + 1,
    })),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const initStart = Date.now();
await request("initialize", {
  processId: process.pid,
  rootUri: pathToFileURL(root).href,
  capabilities: { textDocument: { references: {}, callHierarchy: {} } },
  workspaceFolders: [{ uri: pathToFileURL(root).href, name: "fixture" }],
});
send({ jsonrpc: "2.0", method: "initialized", params: {} });
await openFiles();
// Roslyn needs a moment to load the .csproj of the workspace.
await sleep(1500);
const initMs = Date.now() - initStart;
console.log(`initialize + project load: ${initMs} ms`);

/** Targeted ±WINDOW slices around given pointers, ranges merged. */
async function targetedSlices(pointers) {
  const byFile = new Map();
  for (const pointer of pointers) {
    const start = Math.max(1, pointer.line - WINDOW);
    const end = pointer.line + WINDOW;
    if (!byFile.has(pointer.file)) byFile.set(pointer.file, []);
    byFile.get(pointer.file).push({ start, end });
  }
  const parts = [];
  for (const [file, ranges] of byFile) {
    const lines = (await fs.readFile(path.join(root, file), "utf8")).split("\n");
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
      else merged.push(range);
    }
    for (const range of merged) {
      parts.push(
        `### ${file}:${range.start}-${Math.min(range.end, lines.length)}`,
        lines.slice(range.start - 1, range.end).join("\n"),
        "",
      );
    }
  }
  return parts.join("\n");
}

const result = { server: "csharp-ls 0.28.0 (Roslyn)", initMs, cases: [] };

const caseDefinitions = [
  {
    id: "cs-user-service",
    class: { file: "Services/UserService.cs", needle: "class UserService" },
    member: { file: "Services/UserService.cs", needle: "GetUser(int id)", occurrence: 1 },
    expectedIn: [
      { from: "RequestHandler.HandleGetUser", to: "UserService.constructor" },
      { from: "RequestHandler.AuditUsers", to: "UserService.constructor" },
      { from: "RequestHandler.HandleGetUser", to: "UserService.GetUser" },
      { from: "RequestHandler.AuditUsers", to: "UserService.GetUser" },
    ],
  },
  {
    id: "cs-admin-service",
    class: { file: "Services/AdminService.cs", needle: "class AdminService" },
    member: { file: "Services/AdminService.cs", needle: "GetUser(int id)", occurrence: 1 },
    expectedIn: [
      { from: "RequestHandler.HandleGetUser", to: "AdminService.constructor" },
      { from: "RequestHandler.HandleGetUser", to: "AdminService.GetUser" },
    ],
  },
  {
    id: "cs-picker-dispatch",
    class: { file: "Services/Pickers.cs", needle: "class SlowPicker" },
    member: { file: "Services/Pickers.cs", needle: "GetUser(int id)", occurrence: 2 },
    expectedIn: [{ from: "RequestHandler.HandleViaPicker", to: "SlowPicker.GetUser" }],
  },
];

for (const definition of caseDefinitions) {
  const classTypePosition = findTypePosition(definition.class.file, definition.class.needle);
  const classRefs = await referencesAt(definition.class.file, classTypePosition);
  const memberRefs = await references(definition.member.file, definition.member.needle, definition.member.occurrence);
  let hierarchy = { supported: false };
  try {
    hierarchy = await callHierarchy(definition.member.file, definition.member.needle, definition.member.occurrence);
  } catch (error) {
    hierarchy = { supported: false, error: String(error).slice(0, 120) };
  }

  // usages de classe: everything that is not the declaration itself
  const classUsages = classRefs.locations.filter(
    (loc) => !(loc.file === definition.class.file && loc.line === classTypePosition.line + 1),
  );
  const memberPosition = needlePosition(definition.member.file, definition.member.needle, definition.member.occurrence);
  const memberCallSites = memberRefs.locations.filter(
    (loc) => !(loc.file === definition.member.file && loc.line === memberPosition.line + 1),
  );
  const incoming = [...classUsages.map((loc) => ({ name: "(usage classe)", ...loc })), ...memberCallSites.map((loc) => ({ name: "(appel)", ...loc }))];
  const outgoing = hierarchy.outgoing ?? [];

  const payloadLines = [
    `# lsp ${path.basename(definition.class.file)} (relations résolues)`,
    ...incoming.map((entry) => `IN  ${entry.name} @${entry.file}:${entry.line}`),
    ...hierarchy.incoming?.map((entry) => `IN  ${entry.name} (hierarchy) @${entry.file}:${entry.line}`) ?? [],
    ...outgoing.map((entry) => `OUT ${entry.name} @${entry.file}:${entry.line}`),
  ];
  const slices = await targetedSlices(incoming);
  const payloadTok = tokens(payloadLines.join("\n"));
  const sliceTok = tokens(slices);

  // Which expected IN rows can LSP prove or point at?
  const covered = definition.expectedIn.filter((row) =>
    incoming.some(
      (entry) =>
        (row.to.endsWith("constructor") && entry.name === "(usage classe)") ||
        (!row.to.endsWith("constructor") && (entry.name === "(appel)" || (hierarchy.incoming ?? []).some((item) => entry.name.includes(item.name)))),
    ) || (hierarchy.incoming ?? []).some((item) => row.from.endsWith(item.name)),
  );

  result.cases.push({
    id: definition.id,
    tokens: payloadTok + sliceTok,
    payloadTokens: payloadTok,
    targetedTokens: sliceTok,
    incomingCovered: covered.length,
    incomingTotal: definition.expectedIn.length,
    hierarchySupported: hierarchy.supported,
    incoming,
    hierarchyIncoming: hierarchy.incoming ?? null,
    outgoing,
    durations: { classRefsMs: classRefs.durationMs, memberRefsMs: memberRefs.durationMs },
  });
  console.log(
    `${definition.id}: usages ${classUsages.length}, appels ${memberCallSites.length}, hierarchy ${hierarchy.supported ? (hierarchy.incoming?.length ?? 0) + "/" + (hierarchy.outgoing?.length ?? 0) : "non supporté"}, IN couvert ${covered.length}/${definition.expectedIn.length}, tokens ${payloadTok + sliceTok}`,
  );
}

await fs.writeFile(path.join(here, "lsp-result.json"), JSON.stringify(result, null, 2));
console.log("wrote lsp-result.json");
child.kill();
