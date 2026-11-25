import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { createChangesTour, createProjectTour } from "../../src";
import type { CreationFailure, CreationResult } from "../../src";
import {
  HTML_BYTES,
  SVG_IMAGE,
  TINY_JPEG,
  TINY_PNG,
  oversizedPng,
  writeImageFile,
} from "../helpers/image-fixtures";
import {
  commitFile,
  git,
  headSha,
  initGitRepo,
  readTourFile,
  rmrf,
  tempDir,
  tourFileValidAgainstSchema,
} from "../helpers/test-utils";

// The local-image rules, driven through the published entry points: a proposal
// carries Markdown image references, the creation rules verify them against the
// workspace, and a failing reference refuses the whole Tour without writing
// anything (spec #320, Testing Decisions).

function refusal(result: CreationResult): CreationFailure {
  assert.equal(result.ok, false, "the creation was accepted");
  assert.ok(!result.ok);
  return result;
}

function issuePaths(failure: CreationFailure): string[] {
  return (failure.issues ?? []).map(issue => issue.path);
}

function issueMessages(failure: CreationFailure): string[] {
  return (failure.issues ?? []).map(issue => issue.message);
}

function tourExists(workspaceRoot: string, relativePath: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, relativePath));
}

test("accepts a local image under the tour's own image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/architecture.png", TINY_PNG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/architecture.png).",
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok);
    assert.equal(result.kind, "project");
    const tour = readTourFile(root, ".tours/project.tour");
    const description = (tour.steps as { description: string }[])[0].description;
    assert.ok(description.includes("architecture.png"));
    assert.ok(tourFileValidAgainstSchema(root, ".tours/project.tour"));
  } finally {
    rmrf(root);
  }
});

test("accepts a JPEG image under the tour's own image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/screen.jpg", TINY_JPEG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "See ![the screen](.tours/images/project/screen.jpg).",
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmrf(root);
  }
});

test("rejects an image reference whose file does not exist", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "See ![the architecture](.tours/images/project/missing.png).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), [
      "steps[0].description.image[0]",
    ]);
    assert.ok(
      issueMessages(refused)[0].includes(".tours/images/project/missing.png")
    );
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("accepts a project image that already exists in the workspace", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, "docs/logo.png", TINY_PNG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: { steps: [{ description: "See ![the logo](docs/logo.png)." }] },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok);
    assert.equal(result.kind, "project");
  } finally {
    rmrf(root);
  }
});

test("rejects an absolute image path", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: { steps: [{ description: "See ![the logo](/etc/logo.png)." }] },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.ok(issueMessages(refused)[0].includes("/etc/logo.png"));
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an image path escaping the workspace root", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [{ description: "See ![the logo](../outside/logo.png)." }],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.ok(issueMessages(refused)[0].includes("../outside/logo.png"));
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an image reached through a symlink escaping the workspace root", async () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    writeImageFile(outside, "logo.png", TINY_PNG);
    fs.symlinkSync(outside, path.join(root, "linked"));
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [{ description: "See ![the logo](linked/logo.png)." }],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.match(issueMessages(refused)[0], /symlinks escaping the workspace/);
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});

test("rejects a reference into another tour's image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/onboarding-backend/logo.png", TINY_PNG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "See ![the logo](.tours/images/onboarding-backend/logo.png).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.ok(
      issueMessages(refused)[0].includes(
        ".tours/images/onboarding-backend/logo.png"
      )
    );
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an image whose content is not PNG or JPEG despite its extension", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/fake.png", HTML_BYTES);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: "See ![the fake](.tours/images/project/fake.png).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    const message = issueMessages(refused)[0];
    assert.ok(message.includes(".tours/images/project/fake.png"));
    assert.ok(message.includes("PNG or JPEG"));
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an SVG image", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/icon.svg", SVG_IMAGE);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: "See ![the icon](.tours/images/project/icon.svg).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    const message = issueMessages(refused)[0];
    assert.ok(message.includes(".tours/images/project/icon.svg"));
    assert.ok(message.includes("SVG"));
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("rejects an image larger than 2 MB", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/huge.png", oversizedPng());
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: "See ![the huge one](.tours/images/project/huge.png).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    const message = issueMessages(refused)[0];
    assert.ok(message.includes(".tours/images/project/huge.png"));
    assert.ok(message.includes("2 MB"));
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("derives the tour image directory from the provided fileName", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/onboarding-backend/logo.png", TINY_PNG);
    writeImageFile(root, ".tours/images/project/logo.png", TINY_PNG);
    const accepted = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        fileName: "onboarding-backend",
        steps: [
          {
            description:
              "See ![the logo](.tours/images/onboarding-backend/logo.png).",
          },
        ],
      },
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.ok(accepted.ok);
    assert.ok(accepted.tourPath.endsWith(path.join(".tours", "onboarding-backend.tour")));

    const rejected = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        fileName: "onboarding-backend",
        steps: [
          {
            description: "See ![the logo](.tours/images/project/logo.png).",
          },
        ],
      },
    });
    const refused = refusal(rejected);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.ok(
      issueMessages(refused)[0].includes(".tours/images/project/logo.png")
    );
    assert.equal(tourExists(root, ".tours/onboarding-backend.tour"), true);
  } finally {
    rmrf(root);
  }
});

test("accepts images in subfolders of the tour's image directory", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/flows/arch.png", TINY_PNG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "See ![the flows](.tours/images/project/flows/arch.png).",
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmrf(root);
  }
});

test("aggregates image issues from the tour-level description and several steps", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        description: "See ![the logo](.tours/images/project/missing.png).",
        steps: [
          {
            description:
              "See ![the logo](.tours/images/project/also-missing.png).",
          },
          { description: "A fine step." },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), [
      "description.image[0]",
      "steps[0].description.image[0]",
    ]);
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("ignores image references inside code fences", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: [
              "Markdown image syntax looks like this:",
              "",
              "```markdown",
              "![alt](.tours/images/project/missing.png)",
              "```",
              "",
              "But the step itself has no local image.",
            ].join("\n"),
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmrf(root);
  }
});

test("keeps https and data images outside the local file checks", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description:
              "Remote ![diagram](https://example.com/diagram.png) and inline ![pixel](data:image/png;base64,iVBORw0KGgo=).",
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmrf(root);
  }
});

test("preserves the previous tour when image validation fails", async () => {
  const root = tempDir();
  try {
    const first = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        title: "Original",
        steps: [{ description: "Original step." }],
      },
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const before = readTourFile(root, ".tours/project.tour");

    const second = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        title: "Broken",
        steps: [
          {
            description: "See ![the logo](.tours/images/project/missing.png).",
          },
        ],
      },
    });
    const refused = refusal(second);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(readTourFile(root, ".tours/project.tour"), before);
  } finally {
    rmrf(root);
  }
});

test("accepts and rejects local images in a changes tour", async () => {
  const root = tempDir();
  await initGitRepo(root);
  await commitFile(root, "base.txt", "base content\n", "add base file");
  const baseSha = await headSha(root);
  await git(["checkout", "-b", "feature"], root);
  await commitFile(root, "feature.txt", "feature content\n", "add feature file");
  const head = await headSha(root);
  try {
    writeImageFile(root, ".tours/images/changes/review.png", TINY_PNG);
    writeImageFile(root, ".tours/images/project/logo.png", TINY_PNG);

    const accepted = await createChangesTour({
      workspaceRoot: root,
      proposal: {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description: "See ![the review](.tours/images/changes/review.png).",
            file: "feature.txt",
          },
        ],
      },
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.ok(accepted.ok);
    assert.equal(accepted.kind, "changes");

    const rejected = await createChangesTour({
      workspaceRoot: root,
      proposal: {
        baseRef: baseSha,
        headRef: head,
        steps: [
          {
            description: "See ![the logo](.tours/images/project/logo.png).",
            file: "feature.txt",
          },
        ],
      },
    });
    const refused = refusal(rejected);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.ok(readTourFile(root, ".tours/changes.tour").title);
  } finally {
    rmrf(root);
  }
});

test("rejects a local image reference whose path contains spaces when the file is missing", async () => {
  const root = tempDir();
  try {
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: "See ![the arch](.tours/images/project/my arch.png).",
          },
        ],
      },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "INVALID_PROPOSAL");
    assert.deepEqual(issuePaths(refused), ["steps[0].description.image[0]"]);
    assert.ok(
      issueMessages(refused)[0].includes(".tours/images/project/my arch.png")
    );
    assert.equal(tourExists(root, ".tours/project.tour"), false);
  } finally {
    rmrf(root);
  }
});

test("accepts an existing local image whose path contains spaces", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, ".tours/images/project/my arch.png", TINY_PNG);
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        steps: [
          {
            description: "See ![the arch](.tours/images/project/my arch.png).",
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok);
    assert.equal(result.kind, "project");
  } finally {
    rmrf(root);
  }
});

test("validates image references against the workspace root, not the selected workspacePath", async () => {
  const root = tempDir();
  try {
    writeImageFile(root, "docs/logo.png", TINY_PNG);
    fs.mkdirSync(path.join(root, "subdir"));
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: {
        workspacePath: "subdir",
        steps: [{ description: "See ![the logo](docs/logo.png)." }],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.ok);
    assert.equal(result.kind, "project");
  } finally {
    rmrf(root);
  }
});

test("refuses an output directory that resolves outside the workspace and writes nothing", async () => {
  const root = tempDir();
  const outside = tempDir();
  try {
    // The Tours directory is a symlink to another tree: the write would land
    // outside the workspace, so creation is refused instead.
    fs.symlinkSync(outside, path.join(root, ".tours"));
    const result = await createProjectTour({
      workspaceRoot: root,
      proposal: { steps: [{ description: "Anything." }] },
    });
    const refused = refusal(result);
    assert.equal(refused.code, "OUTPUT_PATH_ESCAPES_WORKSPACE");
    assert.match(refused.message, /resolves outside the workspace root/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    rmrf(root);
    rmrf(outside);
  }
});
