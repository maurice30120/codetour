import { test } from "node:test";
import * as assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { rmrf, tempDir, withServer } from "../helpers/test-utils";
import {
  CHANGES_TOUR_PROMPT_RESOURCE_TEMPLATE,
  GENERATE_CHANGES_TOUR_PROMPT_NAME,
  GENERATE_PROJECT_TOUR_PROMPT_NAME,
  PROJECT_TOUR_PROMPT_RESOURCE_URI,
} from "../../src/server";

// The integration seam plays the host agent: the tests read the generation
// prompt resources through the served MCP protocol, the same way the Copilot
// adapter will, and pin only the contract clauses — never the exact prompt
// wording.

function changesTourPromptUri(reviewMode: string): string {
  return CHANGES_TOUR_PROMPT_RESOURCE_TEMPLATE.replace(
    "{reviewMode}",
    reviewMode
  );
}

async function readResourceText(
  client: Client,
  uri: string
): Promise<string> {
  const response = await client.readResource({ uri });
  const content = response.contents[0] as { uri?: string; text?: string };
  assert.equal(content.uri, uri);
  return content.text ?? "";
}

test("serves the Project Tour generation prompt resource", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(
        client,
        PROJECT_TOUR_PROMPT_RESOURCE_URI
      );
      // The prompt addresses the host agent and cites the Project Tour tool.
      assert.ok(text.length > 0, "the prompt resource must not be empty");
      assert.ok(text.includes("create_project_tour"));
      // Hosts like Copilot register the tool with a server-name prefix; the
      // prompt must tell the agent where to search for it.
      assert.ok(text.includes("codetour-create_project_tour"));
      // Project Tours have no review mode: none may be mentioned.
      assert.ok(!text.includes("reviewMode"));
      assert.ok(!text.includes("review mode"));
      assert.ok(!text.includes("neutral"));
      assert.ok(!text.includes("critical"));
    });
  } finally {
    rmrf(root);
  }
});

test("exposes the prompt resources and the review-mode template over the protocol", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const { resources } = await client.listResources();
      const uris = resources.map((resource) => resource.uri);
      assert.ok(
        uris.includes(PROJECT_TOUR_PROMPT_RESOURCE_URI),
        "the Project Tour prompt must be listed as a fixed resource"
      );
      const { resourceTemplates } = await client.listResourceTemplates();
      assert.ok(
        resourceTemplates.some(
          (template) => template.uriTemplate === CHANGES_TOUR_PROMPT_RESOURCE_TEMPLATE
        ),
        "the Changes Tour prompt must be listed as a parameterized template"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("serves the neutral Changes Tour generation prompt", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(
        client,
        changesTourPromptUri("neutral")
      );
      assert.ok(text.length > 0, "the prompt resource must not be empty");
      assert.ok(text.includes("create_changes_tour"));
      assert.ok(text.includes("codetour-create_changes_tour"));
      assert.ok(text.includes("neutral"), "the prompt must cite the mode");
      // Contract clauses: Git comparison, Tour Anchors, validation,
      // destination, dryRun.
      assert.ok(text.includes("merge-base"));
      assert.ok(text.includes("Tour Anchor"));
      assert.ok(text.includes("validation"));
      assert.ok(text.includes(".tours/changes.tour"));
      assert.ok(text.includes("dryRun"));
      // Neutral mode: factual explanation, no quality judgment, and no
      // embedded review skill.
      assert.ok(text.includes("factually"));
      assert.ok(text.includes("Do not judge"));
      assert.ok(!text.includes("Matt Pocock"));
    });
  } finally {
    rmrf(root);
  }
});

test("serves the critical Changes Tour generation prompt with the embedded skill pack", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const text = await readResourceText(
        client,
        changesTourPromptUri("critical")
      );
      assert.ok(text.length > 0, "the prompt resource must not be empty");
      assert.ok(text.includes("create_changes_tour"));
      assert.ok(text.includes("critical"), "the prompt must cite the mode");
      // Contract clauses: Git comparison, Tour Anchors, validation,
      // destination, dryRun.
      assert.ok(text.includes("merge-base"));
      assert.ok(text.includes("Tour Anchor"));
      assert.ok(text.includes("validation"));
      assert.ok(text.includes(".tours/changes.tour"));
      assert.ok(text.includes("dryRun"));
      // The critical prompt embeds the shared review skill pack (the one
      // served by codetour://review/critical-instructions) and requires
      // reading it before any analysis or step writing.
      assert.ok(text.includes("Matt Pocock"));
      assert.ok(text.includes("Standards"));
      assert.ok(text.includes("Spec"));
      assert.ok(text.includes("MIT"));
      assert.ok(text.includes("before any analysis"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an unknown Changes Tour review mode", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      await assert.rejects(
        readResourceText(client, changesTourPromptUri("angry"))
      );
    });
  } finally {
    rmrf(root);
  }
});

// The prompts/get form composes the served instructions for one run; the
// optional brief is the phrase accompanying the user's request, carried
// verbatim with the orientation and language clauses.
function promptText(messages: Array<{ content: unknown }>): string {
  return messages
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (content && typeof content === "object" && "text" in content) {
        const text = (content as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n");
}

test("lists the generation prompts", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((prompt) => prompt.name);
      assert.ok(
        names.includes(GENERATE_PROJECT_TOUR_PROMPT_NAME),
        "the Project Tour generation prompt must be listed"
      );
      assert.ok(
        names.includes(GENERATE_CHANGES_TOUR_PROMPT_NAME),
        "the Changes Tour generation prompt must be listed"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("serves the Project Tour generation prompt without orientation", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const prompt = await client.getPrompt({
        name: GENERATE_PROJECT_TOUR_PROMPT_NAME,
      });
      const text = promptText(prompt.messages);
      assert.ok(text.includes("create_project_tour"));
      assert.ok(
        !text.includes("Tour orientation"),
        "no orientation clause without a brief"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("composes the Project Tour generation prompt with the user's orientation", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const brief = "Explique-moi le flux d'authentification, de la connexion à la session.";
      const prompt = await client.getPrompt({
        name: GENERATE_PROJECT_TOUR_PROMPT_NAME,
        arguments: { brief },
      });
      const text = promptText(prompt.messages);
      assert.ok(text.includes("create_project_tour"));
      assert.ok(text.includes("Tour orientation"));
      // The user's words travel verbatim: they orient the Tour and their
      // language is the Tour's language.
      assert.ok(text.includes(brief));
      assert.ok(
        text.includes("that same language"),
        "the composed prompt sets the Tour's language from the brief"
      );
    });
  } finally {
    rmrf(root);
  }
});

test("composes the Changes Tour generation prompt with review mode and orientation", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const brief = "Montre comment le nouveau mode critique est câblé.";
      const prompt = await client.getPrompt({
        name: GENERATE_CHANGES_TOUR_PROMPT_NAME,
        arguments: { reviewMode: "neutral", brief },
      });
      const text = promptText(prompt.messages);
      assert.ok(text.includes("create_changes_tour"));
      assert.ok(text.includes("neutral"));
      assert.ok(text.includes(brief));
      const withoutBrief = await client.getPrompt({
        name: GENERATE_CHANGES_TOUR_PROMPT_NAME,
        arguments: { reviewMode: "critical" },
      });
      assert.ok(promptText(withoutBrief.messages).includes("critical"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an unknown review mode in the Changes Tour generation prompt", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      await assert.rejects(
        client.getPrompt({
          name: GENERATE_CHANGES_TOUR_PROMPT_NAME,
          arguments: { reviewMode: "angry" },
        })
      );
    });
  } finally {
    rmrf(root);
  }
});
