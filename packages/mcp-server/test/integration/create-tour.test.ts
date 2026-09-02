import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  callTool,
  issuePaths,
  readTourFile,
  rmrf,
  structuredCode,
  structuredIssues,
  tempDir,
  tourFileValidAgainstSchema,
  warningCodes,
  withServer,
  writeFile,
} from "../helpers/test-utils";
import {
  ALLOWED_DIAGRAM_SOURCES,
  INVALID_FLOWCHART_SOURCE,
  captionedDiagram,
  oversizedFlowchartSource,
} from "../helpers/mermaid-fixtures";

const TOUR = "intro.tour";

function validArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fileName: TOUR,
    title: "My Tour",
    steps: [{ description: "A step." }],
    ...overrides,
  };
}

test("exposes exactly one tool named create_tour with the public schema", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name), ["create_tour"]);
      const tool = tools.tools[0];
      assert.ok(tool!.description!.includes("CodeTour Tour"));
      assert.ok(tool!.description!.includes("fileName"));
      assert.ok(tool!.description!.includes("never writes a CodeTour `ref`"));
      assert.ok(tool!.description!.includes("readable Markdown"));
      assert.ok(tool!.description!.includes("short paragraphs separated by blank lines"));
      assert.ok(tool!.description!.includes("bullet or numbered lists"));
      assert.ok(tool!.description!.includes("Avoid dense monolithic paragraphs"));
      assert.ok(tool!.description!.includes("Use Mermaid when it materially clarifies"));
      assert.ok(
        tool!.description!.includes(
          "For architecture, workflow, lifecycle, or multi-module Tours, include at least one Mermaid diagram"
        )
      );
      assert.ok(
        tool!.description!.includes(
          "Omit diagrams only when the Tour has no meaningful relationship"
        )
      );
      assert.ok(tool!.description!.includes("flowchart, sequenceDiagram"));
      assert.ok(tool!.description!.includes("at most 3 Mermaid fences"));
      assert.ok(tool!.description!.includes("20 KB"));
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(properties).sort(),
        ["description", "fileName", "steps", "title"]
      );
      assert.match(
        (properties.description as { description?: string }).description ?? "",
        /readable Markdown overview/
      );
      assert.match(
        (properties.steps as { description?: string }).description ?? "",
        /structured Markdown tied to their Tour Anchors/
      );
    });
  } finally {
    rmrf(root);
  }
});

test("creates a tour with the provided title and never writes a ref", async () => {
  const root = tempDir();
  try {
    writeFile(root, "src/index.ts", "export const answer = 42;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        description: "An overview of the project.",
        steps: [
          { description: "Intro step." },
          { description: "The entry point.", file: "src/index.ts", line: 1 },
        ],
      }));
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, `.tours/${TOUR}`);
      assert.equal(response.structured.stepCount, 2);
      assert.deepEqual(response.structured.warnings, []);
    });
    const tour = readTourFile(root, `.tours/${TOUR}`);
    assert.equal(tour.title, "My Tour");
    assert.equal(tour.description, "An overview of the project.");
    assert.equal(tour.ref, undefined);
    assert.equal(tour.$schema, "https://aka.ms/codetour-schema");
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("creates a tour under an arbitrarily chosen file name", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        fileName: "branch-review.tour",
        title: "Branch review",
        steps: [{ description: "Sole step." }],
      }));
      assert.equal(response.isError, false);
      assert.equal(response.structured.path, ".tours/branch-review.tour");
    });
    assert.ok(fs.existsSync(path.join(root, ".tours/branch-review.tour")));
  } finally {
    rmrf(root);
  }
});

test("omits the description when absent", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs());
      assert.equal(response.isError, false);
    });
    const tour = readTourFile(root, `.tours/${TOUR}`);
    assert.equal(tour.description, undefined);
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("replaces the previous tour atomically on success", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      await callTool(client, "create_tour", validArgs({
        title: "First",
        steps: [{ description: "First step." }],
      }));
      const second = await callTool(client, "create_tour", validArgs({
        title: "Second",
        steps: [{ description: "Second step.", file: "a.ts" }],
      }));
      assert.equal(second.isError, false);
    });
    const tour = readTourFile(root, `.tours/${TOUR}`);
    assert.equal(tour.title, "Second");
    assert.equal((tour.steps as unknown[]).length, 1);
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("works in a workspace that is not a git repository", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "No git here." }],
      }));
      assert.equal(response.isError, false);
      assert.equal(response.structured.status, "created");
    });
  } finally {
    rmrf(root);
  }
});

test("title is required", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", {
        fileName: TOUR,
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("title"));
    });
  } finally {
    rmrf(root);
  }
});

test("title must be a non-empty string", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ title: "   " }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("title"));
    });
  } finally {
    rmrf(root);
  }
});

test("fileName is required", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", {
        title: "My Tour",
        steps: [{ description: "d" }],
      });
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a fileName without the .tour suffix", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ fileName: "intro.txt" }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an empty fileName", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ fileName: "" }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a fileName with a forward slash separator", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ fileName: "sub/intro.tour" }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
    assert.equal(fs.existsSync(path.join(root, ".tours/sub")), false);
  } finally {
    rmrf(root);
  }
});

test("rejects a fileName with a backslash separator", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ fileName: "sub\\intro.tour" }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects '.' and '..' as fileName", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      for (const fileName of [".", ".."]) {
        const response = await callTool(client, "create_tour", validArgs({ fileName }));
        assert.equal(response.isError, true);
        assert.ok(issuePaths(response).includes("fileName"));
      }
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an absolute fileName", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        fileName: path.sep + "tmp" + path.sep + "intro.tour",
      }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("fileName"));
    });
  } finally {
    rmrf(root);
  }
});

test("does not normalize or silently rename the fileName", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        fileName: "MyTour.tour",
      }));
      assert.equal(response.isError, false);
      assert.equal(response.structured.path, ".tours/MyTour.tour");
    });
    assert.ok(fs.existsSync(path.join(root, ".tours", "MyTour.tour")));
  } finally {
    rmrf(root);
  }
});

test("rejects unknown root fields including ref, baseRef, headRef and includeUncommittedChanges", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", {
        fileName: TOUR,
        title: "My Tour",
        steps: [{ description: "d" }],
        ref: "abc123",
        baseRef: "main",
        headRef: "a".repeat(40),
        includeUncommittedChanges: true,
        mode: "project",
        when: "true",
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const paths = issuePaths(response);
      assert.ok(paths.includes("ref"));
      assert.ok(paths.includes("baseRef"));
      assert.ok(paths.includes("headRef"));
      assert.ok(paths.includes("includeUncommittedChanges"));
      assert.ok(paths.includes("mode"));
      assert.ok(paths.includes("when"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an empty steps array with TOUR_STEPS_REQUIRED", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ steps: [] }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "TOUR_STEPS_REQUIRED");
    });
  } finally {
    rmrf(root);
  }
});

test("rejects a missing steps array with TOUR_STEPS_REQUIRED", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", { fileName: TOUR, title: "My Tour" });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "TOUR_STEPS_REQUIRED");
    });
  } finally {
    rmrf(root);
  }
});

test("aggregates top-level Mermaid errors even when steps are missing", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", {
        fileName: TOUR,
        title: "My Tour",
        description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
        steps: [],
      });
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("description.mermaid[0].source"));
      assert.ok(issuePaths(response).includes("steps"));
    });
  } finally {
    rmrf(root);
  }
});

test("accepts all five allowed Mermaid kinds in a Tour", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: Object.entries(ALLOWED_DIAGRAM_SOURCES).map(([kind, source]) => ({
          description: captionedDiagram(`${kind} overview`, source),
        })),
      }));
      assert.equal(response.isError, false, response.text);
      assert.equal(response.structured.stepCount, 5);
    });
    const tour = readTourFile(root, `.tours/${TOUR}`);
    assert.equal((tour.steps as unknown[]).length, 5);
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("aggregates Mermaid errors with fence paths and source locations", async () => {
  const root = tempDir();
  try {
    const description = [
      ["Introductory text", "", "```mermaid", ALLOWED_DIAGRAM_SOURCES.flowchart, "```"].join("\n"),
      captionedDiagram("Unsupported", "pie title Pets\n    \"Dogs\" : 1"),
      captionedDiagram("Oversized", oversizedFlowchartSource()),
      captionedDiagram("Fourth", ALLOWED_DIAGRAM_SOURCES.flowchart),
    ].join("\n\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        description,
        steps: [
          {
            description: captionedDiagram("Broken syntax", INVALID_FLOWCHART_SOURCE),
          },
          {
            description: [
              "**Diagram – malformed caption**",
              "",
              "```mermaid",
              ALLOWED_DIAGRAM_SOURCES.flowchart,
              "```",
            ].join("\n"),
          },
        ],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const issues = structuredIssues(response);
      assert.deepEqual(
        issues.map((issue) => issue.path),
        [
          "description.mermaid[0].caption",
          "description.mermaid[1].kind",
          "description.mermaid[2].source",
          "description.mermaid[3]",
          "steps[0].description.mermaid[0].source",
          "steps[1].description.mermaid[0].caption",
        ]
      );
      assert.ok(issues.every((issue) => issue.message.includes("line")));
    });
    assert.equal(fs.existsSync(path.join(root, `.tours/${TOUR}`)), false);
  } finally {
    rmrf(root);
  }
});

test("preserves the previous tour when Mermaid validation fails", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_tour", validArgs({
        title: "Original",
        steps: [{ description: "Original step." }],
      }));
      assert.equal(first.isError, false);
      const before = readTourFile(root, `.tours/${TOUR}`);

      const second = await callTool(client, "create_tour", validArgs({
        title: "Broken",
        steps: [
          {
            description: captionedDiagram("Broken", INVALID_FLOWCHART_SOURCE),
          },
        ],
      }));
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "INVALID_PROPOSAL");
      assert.deepEqual(readTourFile(root, `.tours/${TOUR}`), before);
    });
  } finally {
    rmrf(root);
  }
});

test("preserves the existing tour when the new proposal is invalid", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const first = await callTool(client, "create_tour", validArgs({
        title: "Original",
        steps: [{ description: "Original step." }],
      }));
      assert.equal(first.isError, false);

      const second = await callTool(client, "create_tour", validArgs({
        title: "Broken",
        steps: [{ description: "Broken step.", file: "missing.ts" }],
      }));
      assert.equal(second.isError, true);
      assert.equal(structuredCode(second), "INVALID_PROPOSAL");
    });
    const tour = readTourFile(root, `.tours/${TOUR}`);
    assert.equal(tour.title, "Original");
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("preserves an existing differently named tour when an invalid proposal targets another name", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      await callTool(client, "create_tour", validArgs({
        fileName: "keep.tour",
        title: "Keep",
        steps: [{ description: "Keep this." }],
      }));
      const broken = await callTool(client, "create_tour", validArgs({
        fileName: "other.tour",
        title: "Broken",
        steps: [{ description: "d", file: "missing.ts" }],
      }));
      assert.equal(broken.isError, true);
    });
    assert.equal(readTourFile(root, ".tours/keep.tour").title, "Keep");
    assert.equal(fs.existsSync(path.join(root, ".tours/other.tour")), false);
  } finally {
    rmrf(root);
  }
});

test("aggregates all step validation errors in one response", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\ntwo\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          { description: "Missing file.", file: "nope.ts", line: 1 },
          { file: "a.ts" },
        ],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const paths = issuePaths(response);
      assert.ok(paths.includes("steps[0].file"));
      assert.ok(paths.includes("steps[0].line"));
      assert.ok(paths.includes("steps[1].description"));
    });
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a directory", async () => {
  const root = tempDir();
  try {
    writeFile(root, "lib/util.ts", "export {};\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "The lib area.", directory: "lib" }],
      }));
      assert.equal(response.isError, false);
    });
    assert.ok(tourFileValidAgainstSchema(root, `.tours/${TOUR}`));
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a unique pattern", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "const x = 1;\nconst y = 2;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          { description: "The y declaration.", file: "a.ts", pattern: "const y" },
        ],
      }));
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("anchors a step on a valid selection", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "export const answer = 42;\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          {
            description: "The answer.",
            file: "a.ts",
            selection: {
              start: { line: 1, character: 21 },
              end: { line: 1, character: 23 },
            },
          },
        ],
      }));
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an out-of-range selection", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "short\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          {
            description: "Too long.",
            file: "a.ts",
            selection: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 99 },
            },
          },
        ],
      }));
      assert.equal(response.isError, true);
      assert.ok(
        structuredIssues(response).some((issue) =>
          issue.path.includes("selection.end.character")
        )
      );
    });
  } finally {
    rmrf(root);
  }
});

test("rejects an out-of-range line", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "Too far.", file: "a.ts", line: 10 }],
      }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].line"));
    });
  } finally {
    rmrf(root);
  }
});

test("warns without blocking when the tour exceeds fifteen steps", async () => {
  const root = tempDir();
  try {
    const steps = Array.from({ length: 16 }, (_, index) => ({
      description: `Step ${index + 1}.`,
    }));
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({ steps }));
      assert.equal(response.isError, false);
      assert.equal(response.structured.stepCount, 16);
      assert.ok(warningCodes(response).includes("STEP_LIMIT_EXCEEDED"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects CodeTour commands, when expressions and uri fields", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          { description: "d", commands: ["workbench.action.quit"] },
          { description: "d", uri: "https://example.com" },
        ],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      const paths = issuePaths(response);
      assert.ok(paths.includes("steps[0].commands"));
      assert.ok(paths.includes("steps[1].uri"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects active markdown URI schemes in descriptions", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          { description: "Run this: [click](command:workbench.action.quit)" },
        ],
      }));
      assert.equal(response.isError, true);
      assert.equal(structuredCode(response), "INVALID_PROPOSAL");
      assert.ok(issuePaths(response).includes("steps[0].description"));
    });
  } finally {
    rmrf(root);
  }
});

test("allows ordinary https links and images in descriptions", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [
          {
            description:
              "See [the docs](https://example.com/docs) and ![diagram](https://example.com/diagram.png).",
          },
        ],
      }));
      assert.equal(response.isError, false);
    });
  } finally {
    rmrf(root);
  }
});

test("rejects absolute paths as anchors", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "d", file: "/etc/passwd" }],
      }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects relative paths escaping the workspace root", async () => {
  const root = tempDir();
  try {
    writeFile(root, "a.ts", "one\n");
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "d", file: "../escape.ts" }],
      }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
  }
});

test("rejects symlinks that escape the workspace root", async () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    writeFile(outside, "secret.ts", "top secret\n");
    writeFile(root, "a.ts", "one\n");
    const fs = await import("node:fs");
    fs.symlinkSync(outside, `${root}/link-out`);
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs({
        steps: [{ description: "d", file: "link-out/secret.ts" }],
      }));
      assert.equal(response.isError, true);
      assert.ok(issuePaths(response).includes("steps[0].file"));
    });
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});

test("returns a human-readable message and a structured result", async () => {
  const root = tempDir();
  try {
    await withServer(root, async (client) => {
      const response = await callTool(client, "create_tour", validArgs());
      assert.equal(response.isError, false);
      assert.ok(response.text.includes(`.tours/${TOUR}`));
      assert.equal(response.structured.status, "created");
      assert.equal(response.structured.path, `.tours/${TOUR}`);
      assert.equal(response.structured.stepCount, 1);
      assert.ok(Array.isArray(response.structured.warnings));
    });
  } finally {
    rmrf(root);
  }
});
