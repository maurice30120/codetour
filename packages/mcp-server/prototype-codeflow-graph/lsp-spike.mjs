import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "fixture/ts");
const server = path.join(here, "node_modules/typescript-language-server/lib/cli.mjs");

const child = spawn(process.execPath, [server, "--stdio"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });

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

function request(method, params, timeoutMs = 20000) {
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

const uri = pathToFileURL(path.join(root, "user-service.ts")).href;
const uriAdmin = pathToFileURL(path.join(root, "admin-service.ts")).href;
const uriApi = pathToFileURL(path.join(root, "api.ts")).href;
const started = Date.now();

await request("initialize", {
  processId: process.pid,
  rootUri: pathToFileURL(root).href,
  capabilities: { textDocument: { references: {}, callHierarchy: {}, documentSymbol: {} } },
  workspaceFolders: [{ uri: pathToFileURL(root).href, name: "fixture" }],
});
send({ jsonrpc: "2.0", method: "initialized", params: {} });
console.log(`initialize: ${Date.now() - started} ms`);

for (const [fileUri, filePath] of [
  [uri, "user-service.ts"],
  [uriAdmin, "admin-service.ts"],
  [uriApi, "api.ts"],
]) {
  const text = await fs.readFile(path.join(root, filePath), "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: fileUri, languageId: "typescript", version: 1, text } },
  });
}

async function symbolPosition(fileUri, name) {
  const symbols = await request("textDocument/documentSymbol", { textDocument: { uri: fileUri } });
  const walk = (list) => {
    for (const symbol of list) {
      if (symbol.name === name) return symbol;
      if (symbol.children) {
        const found = walk(symbol.children);
        if (found) return found;
      }
    }
    return null;
  };
  const symbol = walk(symbols);
  if (!symbol) throw new Error(`symbol ${name} not found`);
  return symbol.selectionRange?.start ?? symbol.location?.range.start ?? symbol.range?.start;
}

const relative = (targetUri) => path.relative(root, fileURLToPath(targetUri));

async function references(fileUri, name) {
  const position = await symbolPosition(fileUri, name);
  const startedAt = Date.now();
  const refs = await request("textDocument/references", {
    textDocument: { uri: fileUri },
    position,
    context: { includeDeclaration: true },
  });
  const duration = Date.now() - startedAt;
  return {
    count: refs.length,
    duration,
    locations: refs.map((ref) => `${relative(ref.uri)}:${ref.range.start.line + 1}`),
  };
}

async function callHierarchy(fileUri, name) {
  const position = await symbolPosition(fileUri, name);
  const startedAt = Date.now();
  const items = await request("textDocument/prepareCallHierarchy", { textDocument: { uri: fileUri }, position });
  const duration = Date.now() - startedAt;
  if (!items || items.length === 0) return { incoming: [], outgoing: [], duration, note: "no item" };
  const item = items[0];
  const incoming = await request("callHierarchy/incomingCalls", { item });
  const outgoing = await request("callHierarchy/outgoingCalls", { item });
  const name_of = (entry) => `${entry.from.name} <- ${entry.from.uri.split("/").pop()}:${entry.from.range.start.line + 1}`;
  return {
    duration,
    incoming: incoming.map((entry) => `${entry.from.name} (${entry.from.uri.split("/").pop()}:${entry.from.selectionRange.start.line + 1})`),
    outgoing: outgoing.map((entry) => `${entry.to.name} (${entry.to.uri.split("/").pop()}:${entry.to.selectionRange.start.line + 1})`),
    raw: name_of,
  };
}

for (const [label, fileUri, name] of [
  ["UserService", uri, "getUser"],
  ["AdminService", uriAdmin, "getUser"],
]) {
  const refs = await references(fileUri, name);
  const hierarchy = await callHierarchy(fileUri, name);
  console.log(`\n## ${label}.${name}`);
  console.log(`references (${refs.duration} ms):`, refs.count, refs.locations.join(", "));
  console.log(`incoming (${hierarchy.duration} ms):`, hierarchy.incoming.join(" | ") || "(none)");
  console.log(`outgoing:`, hierarchy.outgoing.join(" | ") || "(none)");
}

for (const [label, fileUri, name] of [
  ["class UserService", uri, "UserService"],
  ["class AdminService", uriAdmin, "AdminService"],
  ["class BaseService", pathToFileURL(path.join(root, "base-service.ts")).href, "BaseService"],
]) {
  const text = await fs.readFile(fileURLToPath(fileUri), "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: fileUri, languageId: "typescript", version: 1, text } },
  });
  const refs = await references(fileUri, name);
  console.log(`\n## ${label} (usages)`);
  console.log(`references (${refs.duration} ms):`, refs.count, refs.locations.join(", "));
}

child.kill();
