import { test } from "node:test";
import * as assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  commitFile,
  headSha,
  initGitRepo,
  rmrf,
  tempDir,
  withServer,
} from "../helpers/test-utils";
import {
  PROJECT_TARGETED_CONTEXT_RESOURCE_URI,
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
