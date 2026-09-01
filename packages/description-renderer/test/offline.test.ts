import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { renderDescription } from "../src/description";
import {
  CAPTIONED_FLOWCHART_DESCRIPTION,
  assertValidPng,
  extractPngDataUri
} from "./helpers/fixtures";

function blockNetwork(): { attempts: () => number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  let attempted = 0;

  const countAttempt = () => {
    attempted++;
  };

  const failingConnect = (function(
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    countAttempt();
    throw new Error("Network access was attempted during rendering");
  } as unknown as typeof net.Socket.prototype.connect);

  globalThis.fetch = (async () => {
    countAttempt();
    throw new Error("Network access was attempted during rendering");
  }) as typeof fetch;

  Object.defineProperty(net.Socket.prototype, "connect", {
    value: failingConnect,
    configurable: true,
    writable: true,
    enumerable: false
  });

  return {
    attempts: () => attempted,
    restore() {
      globalThis.fetch = originalFetch;
      Object.defineProperty(net.Socket.prototype, "connect", {
        value: originalConnect,
        configurable: true,
        writable: true,
        enumerable: false
      });
    }
  };
}

function listFilesRecursive(directory: string): string[] {
  const entries: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFilesRecursive(entryPath));
    } else {
      entries.push(entryPath);
    }
  }
  return entries;
}

test("renderDescription renders a flowchart with network access blocked", async () => {
  const network = blockNetwork();

  try {
    const content = await renderDescription(
      CAPTIONED_FLOWCHART_DESCRIPTION,
      "light"
    );
    assertValidPng(extractPngDataUri(content, "Diagram — Request lifecycle"));
    assert.equal(network.attempts(), 0);
  } finally {
    network.restore();
  }
});

test("renderDescription creates no generated SVG or PNG file", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "codetour-renderer-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);
    const content = await renderDescription(
      CAPTIONED_FLOWCHART_DESCRIPTION,
      "dark"
    );
    assertValidPng(extractPngDataUri(content, "Diagram — Request lifecycle"));

    const files = listFilesRecursive(sandbox);
    assert.deepEqual(
      files,
      [],
      "Expected the renderer to leave the workspace without generated assets"
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
