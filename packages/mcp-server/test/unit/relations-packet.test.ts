import * as assert from "node:assert";
import { test, describe, before, after } from "node:test";
import {
  extractPaginatedTargetedContext,
  extractProjectTargetedContext,
  extractTargetedContext,
  formatPaginatedContextForPrompt,
  formatTargetedContextForPrompt,
  DEFAULT_TARGETED_CONTEXT_CONFIG,
} from "../../src/targeted-context";
import type { RelationsPacket } from "../../src/targeted-context";
import { WorkspaceContext } from "../../src/types";
import {
  commitFile,
  headSha,
  initGitRepo,
  rmrf,
  tempDir,
} from "../helpers/test-utils";

// Ticket #155 (spec #149): the depth-1 relations packet rides the EXISTING
// Targeted Context flag (ADR 0033: off by default, no new flag). These tests
// pin the seams: flag off => the historical disabled result, untouched; flag
// on => a coherent packet from the same scan pass, with explicit unsupported
// files, merged targeted slices and pagination-honoring seeds.

let root: string;
let ctx: WorkspaceContext;
let baseRef: string;
let headRef: string;

const REPO_TS = `export class UserRepository {
  find(id: number): string {
    return \`user-\${id}\`;
  }
}
`;

const SERVICE_TS = `import { UserRepository } from "./repo";

export class UserService {
  private repo = new UserRepository();

  getUser(id: number): string {
    return this.repo.find(id);
  }

  render(): string {
    return "service";
  }
}
`;

// The ambiguous call (view.render() on an untyped parameter) sits far enough
// from the file edges that the default ±8-line window is observable; two
// same-named render() methods give the site its candidates.
const CALLER_TS = `import { UserService } from "./service";

// padding 1
// padding 2
// padding 3
// padding 4
// padding 5
// padding 6
// padding 7
// padding 8
// padding 9
// padding 10
export function loadUser(id: number, view: unknown): string {
  const service = new UserService();
  const name = service.getUser(id);
  view.render();
  return name;
}

export class ReportView {
  render(): string {
    return "report";
  }
}
`;

const GO_FILE = `package main

func main() {}
`;

async function setup() {
  root = tempDir("codetour-relations-packet-");
  await initGitRepo(root);
  ctx = { root, realRoot: root };

  await commitFile(root, "src/repo.ts", REPO_TS, "base repo");
  await commitFile(root, "src/service.ts", SERVICE_TS, "base service");
  await commitFile(root, "src/caller.ts", CALLER_TS, "base caller");
  await commitFile(root, "src/legacy.go", GO_FILE, "base go");
  baseRef = await headSha(root);

  // Head touches the TypeScript files AND the Go file: the selection then
  // contains both pack-covered and out-of-pack files.
  await commitFile(root, "src/service.ts", SERVICE_TS + "\n// head touch\n", "head service");
  await commitFile(root, "src/caller.ts", CALLER_TS + "\n// head touch\n", "head caller");
  await commitFile(root, "src/legacy.go", GO_FILE + "\n// head touch\n", "head go");
  headRef = await headSha(root);
}

async function cleanup() {
  if (root) rmrf(root);
}

describe("relations packet under the existing Targeted Context flag (#155)", () => {
  before(setup);
  after(cleanup);

  test("flag off => the historical disabled result, with no relations packet", async () => {
    const result = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 50 },
      { enabled: false }
    );
    assert.equal(result.success, true);
    const context = result.context!;
    // Historical shape pinned field by field (ADR 0033 non-regression).
    assert.equal(context.enabled, false);
    assert.deepEqual(context.files, []);
    assert.equal(context.totalSymbols, 0);
    assert.deepEqual(context.totalTokenUsage, {
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      timestamp: context.totalTokenUsage.timestamp,
    });
    assert.deepEqual(context.totalCost, {});
    assert.ok(!("relations" in context), "flag off => no relations key at all");
    assert.ok(!result.paginatedContext, "flag off => no paginated context");
    assert.deepEqual(result.warnings, [
      "Targeted Context is disabled. Set enabled: true to use it.",
    ]);

    const plain = await extractTargetedContext(ctx, baseRef, headRef, { enabled: false });
    assert.ok(plain.success);
    assert.ok(!("relations" in plain.context!), "flag off => no relations on the plain context either");
  });

  test("flag on => depth-1 packet with coherent statuses and file:line evidence", async () => {
    const result = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 200 },
      { enabled: true, ...pickApproachC() }
    );
    assert.equal(result.success, true);
    const paginated = result.paginatedContext!;
    const packet = paginated.relations as RelationsPacket | undefined;
    assert.ok(packet, "flag on => the packet is attached to the served selection");
    assert.equal(packet!.depth, 1);
    assert.equal(packet!.status, "resolved");
    assert.ok(packet!.seeds.length > 0, "seeds come from the same scan pass");
    assert.ok(
      packet!.seeds.some(s => s.includes("UserService.getUser")),
      `expected the changed method among the seeds, got ${packet!.seeds.join(", ")}`
    );

    // Every asserted relation carries file:line evidence and a status.
    const STATUSES = new Set(["resolved", "heuristic", "ambiguous", "unresolved", "unsupported"]);
    for (const edge of packet!.edges) {
      assert.ok(edge.filePath.length > 0 && edge.line >= 1, "file:line evidence on every edge");
      assert.ok(STATUSES.has(edge.status), `coherent status: ${edge.status}`);
    }
    const names = new Map(packet!.nodes.map(n => [n.id, n.name]));
    const incoming = packet!.edges.filter(e => names.get(e.to) === "UserService.getUser");
    assert.ok(
      incoming.some(e => names.get(e.from) === "loadUser" && e.filePath === "src/caller.ts"),
      "the caller of the changed symbol is in the packet with file:line proof"
    );

    // Dynamic dispatch the pack cannot prove is an explicit "?" site with
    // candidates, never a guessed edge (spec #149 stories 5/19).
    const renderSite = packet!.sites.find(s => s.name === "render");
    assert.ok(renderSite, "the untyped view.render() call is an ambiguity site");
    assert.ok(
      renderSite!.candidates.some(c => c.endsWith(".render")),
      `candidates are the same-named members: ${renderSite!.candidates.join(", ")}`
    );
    assert.ok(
      !packet!.edges.some(e => names.get(e.to)?.endsWith(".render")),
      "no edge is guessed for the ambiguous call"
    );

    // Explicit unsupported for the out-of-pack file — never silence.
    assert.ok(
      packet!.unsupportedFiles.some(f => f.path === "src/legacy.go" && f.language === "go"),
      `unsupported file listed: ${JSON.stringify(packet!.unsupportedFiles)}`
    );

    // Packet token cost is tracked through the existing CostTracker.
    assert.ok(packet!.tokens > 0, "packet token estimate is positive");
    assert.ok(
      paginated.totalTokenUsage.outputTokens >= packet!.tokens,
      "packet tokens are included in the tracked output tokens"
    );
  });

  test("targeted slices: default ±8 window, merged per file; configurable window", async () => {
    const result = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 200 },
      { enabled: true, ...pickApproachC() }
    );
    const packet = result.paginatedContext!.relations!;
    assert.equal(packet.windowLines, 8, "default window is ±8 lines");
    assert.ok(packet.sites.length > 0, "the fixture has an ambiguity site");
    const callerSites = packet.sites.filter(s => s.file === "src/caller.ts");
    assert.ok(callerSites.length >= 1);
    const callerSlices = packet.slices.filter(s => s.filePath === "src/caller.ts");
    assert.ok(callerSlices.length >= 1, "slices exist around ambiguity pointers");
    for (const site of callerSites) {
      // every site is covered by at least one slice range
      const covered = callerSlices.some(
        s => s.startLine <= site.line && site.line <= s.endLine
      );
      assert.ok(covered, `site at line ${site.line} covered by a slice`);
    }
    for (const slice of callerSlices) {
      assert.ok(slice.text.length > 0, "the slice carries the targeted lines, not the whole file");
    }
    // slice ranges are merged per file, never overlapping
    const sorted = [...callerSlices].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].startLine > sorted[i - 1].endLine,
        "slice ranges are merged, never overlapping"
      );
    }

    const narrow = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 200 },
      { enabled: true, ...pickApproachC(), relationsWindow: 2 }
    );
    const narrowPacket = narrow.paginatedContext!.relations!;
    assert.equal(narrowPacket.windowLines, 2, "configurable window honored");
    const span = (p: typeof packet) =>
      p.slices.reduce((sum, s) => sum + (s.endLine - s.startLine + 1), 0);
    assert.ok(
      span(narrowPacket) < span(packet),
      "a ±2 window yields strictly narrower slices than the default ±8"
    );
    for (const site of narrowPacket.sites) {
      assert.ok(
        narrowPacket.slices.some(
          s => s.filePath === site.file && s.startLine <= site.line && site.line <= s.endLine
        ),
        "every pointer is still covered at ±2"
      );
    }
  });

  test("the packet honors the existing pagination: seeds follow the served page", async () => {
    const page1 = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 1 },
      { enabled: true, ...pickApproachC() }
    );
    const p1 = page1.paginatedContext!;
    assert.equal(p1.pagination.page, 1);
    const page1Symbols = p1.pages.flatMap(pg => pg.symbols.map(s => s.name));
    assert.equal(page1Symbols.length, 1, "one symbol on page 1");
    const packet1 = p1.relations!;
    assert.ok(
      packet1.seeds.length <= 2,
      `page-scoped seeds (${packet1.seeds.join(", ")}) follow the single page symbol`
    );

    const page2 = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 2, pageSize: 1 },
      { enabled: true, ...pickApproachC() }
    );
    const p2 = page2.paginatedContext!;
    assert.equal(p2.pagination.page, 2);
    const page2Symbols = p2.pages.flatMap(pg => pg.symbols.map(s => s.name));
    assert.notDeepEqual(page2Symbols, page1Symbols, "page 2 serves another symbol");
  });

  test("a selection with only out-of-pack files yields an explicit unsupported packet", async () => {
    // A diff touching ONLY the Go file.
    const goOnlyHead = await (async () => {
      await commitFile(root, "src/legacy.go", GO_FILE + "\n// another touch\n", "go only");
      return headSha(root);
    })();
    try {
      const result = await extractPaginatedTargetedContext(
        ctx,
        headRef,
        goOnlyHead,
        { page: 1, pageSize: 50 },
        { enabled: true, ...pickApproachC() }
      );
      assert.equal(result.success, true);
      const packet = result.paginatedContext?.relations ?? result.context!.relations;
      assert.ok(packet, "packet present even when unsupported");
      assert.equal(packet!.status, "unsupported");
      assert.deepEqual(packet!.edges, []);
      assert.ok(
        packet!.unsupportedFiles.some(f => f.path === "src/legacy.go"),
        "the out-of-pack file is named explicitly"
      );
    } finally {
      // restore head so other tests are unaffected (they use baseRef/headRef captured before)
    }
  });

  test("the served markdown carries the relations section (contract clauses)", async () => {
    const result = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1, pageSize: 200 },
      { enabled: true, ...pickApproachC() }
    );
    const text = formatPaginatedContextForPrompt(result.paginatedContext!);
    assert.match(text, /## Relations \(depth 1\)/);
    assert.match(text, /`loadUser` -> `UserService\.getUser`[^\n]*src\/caller\.ts:\d+/);
    assert.match(text, /unsupported/i);
    assert.match(text, /legacy\.go/);
    assert.match(text, /Targeted slices/);
  });

  test("flag off => the formatted historical answer is unchanged (empty)", async () => {
    const result = await extractPaginatedTargetedContext(
      ctx,
      baseRef,
      headRef,
      { page: 1 },
      { enabled: false }
    );
    assert.equal(result.success, true);
    // The resource handler falls back to the plain context formatter.
    assert.equal(formatTargetedContextForPrompt(result.context!), "");
  });

  test("default config keeps the flag off (ADR 0033) and the window default is 8", () => {
    assert.equal(DEFAULT_TARGETED_CONTEXT_CONFIG.enabled, false);
  });

  test("the Project Tour selection carries the packet too, and none when off", async () => {
    const off = await extractProjectTargetedContext(ctx, { enabled: false });
    assert.equal(off.success, true);
    assert.ok(!("relations" in off.context!), "flag off => no relations key on the project context");

    const on = await extractProjectTargetedContext(ctx, {
      enabled: true,
      rootDirectories: ["src"],
      includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go"],
    });
    assert.equal(on.success, true);
    const packet = on.context!.relations;
    assert.ok(packet, "flag on => packet attached to the project selection");
    assert.equal(packet!.status, "resolved");
    assert.ok(
      packet!.unsupportedFiles.some(f => f.path === "src/legacy.go"),
      "out-of-pack file explicitly unsupported"
    );
    assert.ok(
      on.context!.totalTokenUsage.outputTokens >= packet!.tokens,
      "packet tokens tracked through the project CostTracker"
    );
  });
});

/** Approach C bounds (what the served resource uses), minus the flag. */
function pickApproachC() {
  return {
    maxSymbols: 5000,
    pageSize: 200,
    maxFiles: 50,
    maxDepth: 10,
    includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go"],
    excludeExtensions: [".test.", ".spec.", ".d.ts"],
    includeDocumentation: true,
    trackCost: true,
    excludeNodeModules: true,
  };
}
