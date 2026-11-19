const fs = require("node:fs");
const path = require("node:path");

// The npm package ships its two local monorepo dependencies inside
// dist/node_modules, where Node resolves them from dist/src: npm cannot carry
// a `file:` sibling path dependency into an installed tarball. Both packages
// are built first (root `npm run build` builds them in order) and only their
// public build output is copied.
const packageRoot = path.resolve(__dirname, "..");
const stagedModules = path.join(
  packageRoot,
  "packages",
  "mcp-server",
  "dist",
  "node_modules"
);

function stage(name, sourceRoot) {
  const dist = path.join(sourceRoot, "dist");
  if (!fs.existsSync(dist)) {
    throw new Error(
      `The ${name} package must be built before the MCP server can be packaged.`
    );
  }
  const stagedRoot = path.join(stagedModules, name);
  fs.rmSync(stagedRoot, { recursive: true, force: true });
  fs.mkdirSync(stagedRoot, { recursive: true });
  fs.cpSync(dist, path.join(stagedRoot, "dist"), { recursive: true });

  const manifest = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")
  );
  fs.writeFileSync(
    path.join(stagedRoot, "package.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        main: manifest.main,
        types: manifest.types,
      },
      null,
      2
    )}\n`
  );
  return manifest.name;
}

const renderer = stage(
  "codetour-description-renderer",
  path.join(packageRoot, "packages", "description-renderer")
);
// `codetour-knowledge` declares zod ^4 for its own builds and the monorepo
// resolves that version; in the packed artifact it resolves the host package's
// zod, which supports the same restricted schema subset. No zod schema object
// ever crosses the package boundary: the MCP server only calls the compiled
// functions, so the two zod majors never meet.
const knowledge = stage(
  "codetour-knowledge",
  path.join(packageRoot, "packages", "knowledge")
);

console.log(`Staged ${renderer} and ${knowledge} in the MCP package.`);
