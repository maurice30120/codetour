import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalTransport } from "@b9g/termdom";
import { nativeSelectionTransport } from "./terminalTransport";

function hostTransport() {
  const writes: string[] = [];
  let columns = 80;
  let inputReads = 0;
  let suspensions = 0;
  let status: number | undefined;
  const input = new ReadableStream<string>();
  const transport: TerminalTransport = {
    get cols() { return columns; },
    rows: 24,
    get readable() { inputReads++; return input; },
    resizes: new ReadableStream(),
    interactive: true,
    sharesScreen: true,
    ready: Promise.resolve(),
    closed: new Promise(() => undefined),
    writable: new WritableStream<string>({ write: text => { writes.push(text); } }),
    writeSync: text => { writes.push(text); },
    suspend: async () => { suspensions++; },
    close: info => { status = info?.status; }
  };
  return {
    transport, writes,
    resize: (width: number) => { columns = width; },
    inputReads: () => inputReads,
    suspensions: () => suspensions,
    status: () => status
  };
}

test("native selection survives mouse-mode enables while fullscreen, paste and rendered output pass through", async () => {
  const host = hostTransport();
  const transport = nativeSelectionTransport(host.transport);
  const writer = transport.writable.getWriter();
  const fullscreen = "\x1b[?1049h";
  const paste = "\x1b[?2004h";
  const output = "\x1b[38;5;115m+ return token;\x1b[0m";
  await writer.write("\x1b[?1002h\x1b[?1006h" + fullscreen + paste + output);
  assert.equal(host.writes.join(""), fullscreen + paste + output);
  // A later re-enable, such as job-control resume, is also filtered.
  await writer.write("\x1b[?1003;1002;1006;2004h");
  assert.equal(host.writes[host.writes.length - 1], paste);
  // Exit/panic writes use the same policy and keep the mode resets.
  transport.writeSync!("\x1b[?1000h\x1b[?1002l\x1b[?1049l");
  assert.equal(host.writes[host.writes.length - 1], "\x1b[?1002l\x1b[?1049l");
  await writer.close();
});

test("the selection transport preserves live sizes, lazy input and session lifecycle", async () => {
  const host = hostTransport();
  const transport = nativeSelectionTransport(host.transport);
  assert.equal(host.inputReads(), 0);
  assert.equal(transport.cols, 80);
  host.resize(120);
  assert.equal(transport.cols, 120);
  assert.equal(transport.readable, host.transport.readable);
  assert.equal(transport.resizes, host.transport.resizes);
  assert.equal(transport.closed, host.transport.closed);
  assert.equal(transport.interactive, true);
  await transport.suspend!();
  assert.equal(host.suspensions(), 1);
  transport.close({ status: 1 });
  assert.equal(host.status(), 1);
  await transport.writable.close();
});
