import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, symlinkSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCodeTourCommand } from "../.github/extensions/codetour/adapter.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("Copilot selection forwards the selected Tour to the real standalone HTML CLI", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-copilot-adapter-"));
  const previousCli = process.env.CODETOUR_CLI;
  const previousOutput = process.env.CODETOUR_TEST_HTML_OUTPUT;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    for (const [name, title] of [["a", "First Tour"], ["b", "Second Tour"]])
      writeFileSync(path.join(root, ".tours", `${name}.tour`), JSON.stringify({title, steps:[{description: `Content for ${title}`}]}));
    process.env.CODETOUR_CLI = path.resolve("dist/cli.js");
    const output = path.join(root, "result.html");
    process.env.CODETOUR_TEST_HTML_OUTPUT = output;
    const messages = [];
    const session = {capabilities:{ui:{elicitation:true}}, ui:{select: async (_prompt, choices) => choices[1]},
      log: async message => messages.push(message)};
    await runCodeTourCommand(session, "", root);
    for (let i = 0; i < 100 && !existsSync(output); i++) await delay(50);
    assert.ok(existsSync(output), messages.join("\n"));
    assert.match(readFileSync(output, "utf8"), /Second Tour/);
    assert.match(messages.join("\n"), /Starting CodeTour: Second Tour/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    if (previousOutput === undefined) delete process.env.CODETOUR_TEST_HTML_OUTPUT; else process.env.CODETOUR_TEST_HTML_OUTPUT = previousOutput;
    rmSync(root, {recursive:true, force:true});
  }
});


test("missing UI capability is reported without launching a reader", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-copilot-no-ui-"));
  const previousCli = process.env.CODETOUR_CLI;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    for (const name of ["a", "b"]) writeFileSync(path.join(root, ".tours", `${name}.tour`), JSON.stringify({title:name,steps:[{description:"test"}]}));
    process.env.CODETOUR_CLI = path.resolve("dist/cli.js");
    const messages = [];
    await runCodeTourCommand({capabilities:{},log:async text => messages.push(text)}, "", root);
    assert.match(messages.join("\n"), /requires an interactive Copilot session/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    rmSync(root, {recursive:true, force:true});
  }
});


test("a packaged .cmd path uses its bundled runtime without shell interpretation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-adapter-command-"));
  const previousCli = process.env.CODETOUR_CLI;
  const previousOutput = process.env.CODETOUR_TEST_HTML_OUTPUT;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    writeFileSync(path.join(root, ".tours", "a.tour"), JSON.stringify({title:"Safe",steps:[{description:"Package works"}]}));
    const pkg = path.join(root, "package & data");
    mkdirSync(path.join(pkg, "dist"), {recursive:true});
    if (process.platform === "win32") copyFileSync(process.execPath, path.join(pkg, "node.exe"));
    else symlinkSync(process.execPath, path.join(pkg, "node.exe"));
    copyFileSync(path.resolve("dist/cli.js"), path.join(pkg, "dist", "cli.js"));
    cpSync(path.resolve("dist/resvg-runtime"), path.join(pkg, "dist", "resvg-runtime"), {recursive:true});
    // The CLI bundle requires the userland punycode package instead of the
    // deprecated core module; a packaged layout ships it as a closure.
    mkdirSync(path.join(pkg, "dist", "node_modules"), {recursive:true});
    cpSync(path.resolve("node_modules/punycode"), path.join(pkg, "dist", "node_modules", "punycode"), {recursive:true});
    const cmd = path.join(pkg, "codetour.cmd");
    writeFileSync(cmd, "@echo off\r\nexit /b 12\r\n");
    process.env.CODETOUR_CLI = cmd;
    process.env.CODETOUR_TEST_HTML_OUTPUT = path.join(root, "result.html");
    const messages = [];
    await runCodeTourCommand({capabilities:{},log:async text => messages.push(text)}, "Safe", root);
    for (let i = 0; i < 100 && !existsSync(process.env.CODETOUR_TEST_HTML_OUTPUT); i++) await delay(50);
    assert.ok(existsSync(process.env.CODETOUR_TEST_HTML_OUTPUT), messages.join("\n"));
    assert.match(readFileSync(process.env.CODETOUR_TEST_HTML_OUTPUT, "utf8"), /Package works/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    if (previousOutput === undefined) delete process.env.CODETOUR_TEST_HTML_OUTPUT; else process.env.CODETOUR_TEST_HTML_OUTPUT = previousOutput;
    rmSync(root, {recursive:true, force:true});
  }
});
