const fs = require("node:fs");
const path = require("node:path");

// The npm package ships its local monorepo dependencies inside
// dist/node_modules, where Node resolves them from dist/src: npm cannot carry
// a `file:` sibling path dependency into an installed tarball. They are built
// first (root `npm run build` builds them in order) and only their public build
// output is copied.
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

const identityRoot = path.join(packageRoot, "packages", "workspace-identity");
const identityTarget = path.join(stagedModules, "codetour-workspace-identity");
fs.rmSync(identityTarget, { recursive: true, force: true });
fs.mkdirSync(identityTarget, { recursive: true });
for (const file of ["index.js", "index.d.ts", "package.json"]) {
  fs.copyFileSync(path.join(identityRoot, file), path.join(identityTarget, file));
}

const renderer = stage(
  "codetour-description-renderer",
  path.join(packageRoot, "packages", "description-renderer")
);

// The creation rules are an installed dependency of the MCP server: their
// compiled output ships inside dist/node_modules, next to the renderer.
const tourGeneration = stage(
  "codetour-tour-generation",
  path.join(packageRoot, "packages", "tour-generation")
);

console.log(
  `Staged ${renderer}, ${tourGeneration} and workspace identity in the MCP package.`
);
