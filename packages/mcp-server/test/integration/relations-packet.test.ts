import { test } from "node:test";
import * as assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  callTool,
  commitFile,
  headSha,
  initGitRepo,
  rmrf,
  tempDir,
  withServer,
} from "../helpers/test-utils";
import {
  CHANGES_TOUR_PROMPT_RESOURCE_TEMPLATE,
  PROJECT_TARGETED_CONTEXT_RESOURCE_URI,
  PROJECT_TOUR_PROMPT_RESOURCE_URI,
  TARGETED_CONTEXT_RESOURCE_TEMPLATE,
  TARGETED_CONTEXT_PAGINATED_RESOURCE_TEMPLATE,
} from "../../src/server";

// Ticket #155 acceptance, at the highest MCP seam (prior art:
// test/integration/generation-prompt.test.ts): the host plays the Tour
// Generator over stdio. The Targeted Context resource is the per-run opt-in
// of ADR 0033, so reading it serves the selection WITH the relations packet;
// the tool surface stays exactly the two generation tools (no new mandatory
// MCP tool), and the flag-off path is pinned at the extractor seam in
// test/unit/relations-packet.test.ts.

function changesTourContextUri(baseRef: string, headRef: string): string {
  return TARGETED_CONTEXT_RESOURCE_TEMPLATE.replace("{baseRef}", baseRef).replace(
    "{headRef}",
    headRef
  );
}

async function readResourceText(client: Client, uri: string): Promise<string> {
  const response = await client.readResource({ uri });
  const content = response.contents[0] as { uri?: string; text?: string };
  assert.equal(content.uri, uri);
  return content.text ?? "";
}

const REPO_TS = `export interface IRepository {
  find(id: number): string;
}

export class UserRepository implements IRepository {
  find(id: number): string {
    return \`user-\${id}\`;
  }
}
`;

const SERVICE_TS = `import { IRepository, UserRepository } from "./repo";

export class UserService {
  private repo: IRepository = new UserRepository();

  getUser(id: number): string {
    return this.repo.find(id);
  }

  render(): string {
    return "service";
  }
}
`;

const CALLER_TS = `import { UserService } from "./service";

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

async function fixtureRepo(): Promise<{ root: string; baseRef: string; headRef: string }> {
  const root = tempDir("codetour-relations-packet-it-");
  await initGitRepo(root);
  await commitFile(root, "src/repo.ts", REPO_TS, "base repo");
  await commitFile(root, "src/service.ts", SERVICE_TS, "base service");
  await commitFile(root, "src/caller.ts", CALLER_TS, "base caller");
  await commitFile(root, "src/legacy.go", GO_FILE, "base go");
  const baseRef = await headSha(root);
  // repo.ts is touched at head too: the relations packet is built over the
  // CHANGED files, so the IRepository port must be in the selection for the
  // interface edge toward the port to be assertable.
  await commitFile(root, "src/repo.ts", REPO_TS + "\n// head\n", "head repo");
  await commitFile(root, "src/service.ts", SERVICE_TS + "\n// head\n", "head service");
  await commitFile(root, "src/caller.ts", CALLER_TS + "\n// head\n", "head caller");
  await commitFile(root, "src/legacy.go", GO_FILE + "\n// head\n", "head go");
  const headRef = await headSha(root);
  return { root, baseRef, headRef };
}

test("the Changes Tour context resource serves the depth-1 relations packet", async () => {
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(client, changesTourContextUri(baseRef, headRef));

      // The historical selection is still there.
      assert.match(text, /## Targeted Context/);
      assert.match(text, /src\/caller\.ts/);
      assert.match(text, /loadUser/);

      // The relations packet joined the selection (flag-on path of the resource).
      assert.match(text, /## Relations \(depth 1\)/);
      assert.match(text, /`loadUser` -> `UserService\.getUser`[^\n]*src\/caller\.ts:\d+/);
      // Coherent statuses: every rendered edge line carries kind/callType and
      // one of the #149 statuses, with file:line evidence.
      const edgeLines = text.split("\n").filter(l => l.startsWith("- `") && l.includes(" -> `"));
      assert.ok(edgeLines.length > 0, "the packet renders edge lines");
      for (const line of edgeLines) {
        assert.match(
          line,
          /\((call|new|super)\/(direct|interface|super|new), (resolved|heuristic|ambiguous|unresolved|unsupported)\) at [^\s:]+:\d+$/,
          `coherent status on edge line: ${line}`
        );
      }
      // The interface-typed field asserts toward the PORT with a heuristic
      // status, never toward the implementation (#149 story 16).
      assert.match(
        text,
        /`UserService\.getUser` -> `IRepository\.find` \(call\/interface, heuristic\) at src\/service\.ts:\d+/
      );
      assert.ok(!text.includes("UserService.getUser` -> `UserRepository.find"), "no edge toward the implementation");
      // The untyped view.render() is an explicit "?" pointer with candidates.
      assert.match(text, /\? `render`[^\n]*src\/caller\.ts:\d+/);
      assert.match(text, /candidates: [^\n]*UserService\.render/);
      // Out-of-pack file is explicitly unsupported.
      assert.match(text, /unsupported/i);
      assert.match(text, /legacy\.go/);
      // Targeted slices around the ambiguity pointer.
      assert.match(text, /Targeted slices/);
      assert.match(text, /src\/caller\.ts lines \d+-\d+/);
    });
  } finally {
    rmrf(root);
  }
});

test("the paginated form pages the relations with the selection", async () => {
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const uri = TARGETED_CONTEXT_PAGINATED_RESOURCE_TEMPLATE.replace(
        "{baseRef}",
        baseRef
      )
        .replace("{headRef}", headRef)
        .replace("{page}", "1")
        .replace("{pageSize}", "1");
      const text = await readResourceText(client, uri);
      assert.match(text, /Page 1\/\d+/);
      assert.match(text, /Showing 1 symbols on this page/);
      assert.match(text, /## Relations \(depth 1\)/);
    });
  } finally {
    rmrf(root);
  }
});

test("the Project Tour context resource also carries the relations packet", async () => {
  const { root } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(client, PROJECT_TARGETED_CONTEXT_RESOURCE_URI);
      assert.match(text, /## Targeted Context/);
      assert.match(text, /## Relations \(depth 1\)/);
      assert.match(text, /`loadUser` -> `UserService\.getUser`[^\n]*src\/caller\.ts:\d+/);
      // The out-of-pack Go file is explicitly unsupported here too.
      assert.match(text, /unsupported/i);
      assert.match(text, /legacy\.go/);
    });
  } finally {
    rmrf(root);
  }
});

test("flag off (default): the historical generation pipeline is unchanged and no packet appears", async () => {
  // Ticket #156 nappe 2, flag-off clause, at the highest MCP seam: the
  // default (ADR 0033 off) path serves the exact historical responses — the
  // generation tools and the generation prompts carry no relations packet.
  const { root, baseRef, headRef } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const changes = await callTool(client, "create_changes_tour", {
        baseRef,
        headRef,
        steps: [{ description: "Load a user through the service.", file: "src/caller.ts" }],
      });
      assert.equal(changes.isError, false, changes.text);
      assert.equal(changes.structured.stepCount, 1);
      assert.ok(
        !changes.text.includes("Relations (depth 1)"),
        "flag off => no relations packet in the tool response"
      );
      assert.ok(
        !("relations" in (changes.structured ?? {})),
        "flag off => no relations key in the structured response"
      );

      const project = await callTool(client, "create_project_tour", {
        steps: [{ description: "Overview of the workspace.", file: "src/caller.ts" }],
      });
      assert.equal(project.isError, false, project.text);
      assert.ok(!project.text.includes("Relations (depth 1)"));

      // The generation prompt resources are the historical ones too.
      const changesPrompt = await readResourceText(
        client,
        CHANGES_TOUR_PROMPT_RESOURCE_TEMPLATE.replace("{reviewMode}", "neutral")
      );
      assert.ok(changesPrompt.includes("create_changes_tour"));
      assert.ok(
        !changesPrompt.includes("Relations (depth 1)"),
        "flag off => no packet in the Changes Tour prompt"
      );
      const projectPrompt = await readResourceText(client, PROJECT_TOUR_PROMPT_RESOURCE_URI);
      assert.ok(projectPrompt.includes("create_project_tour"));
      assert.ok(
        !projectPrompt.includes("Relations (depth 1)"),
        "flag off => no packet in the Project Tour prompt"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("no new mandatory MCP tool: the surface stays the two generation tools", async () => {
  const { root } = await fixtureRepo();
  try {
    await withServer(root, async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((t) => t.name).sort(),
        ["create_changes_tour", "create_project_tour"]
      );
    });
  } finally {
    rmrf(root);
  }
});
