const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const RESVG_VERSION = "2.6.2";

// VS Code's standard desktop/remote Node targets. Linux artifacts are built
// against glibc; the package must be built again on a musl host if that host
// is added to the published target matrix.
const TARGETS = Object.freeze({
  "darwin-arm64": {
    packageName: "@resvg/resvg-js-darwin-arm64",
    binary: "resvgjs.darwin-arm64.node"
  },
  "darwin-x64": {
    packageName: "@resvg/resvg-js-darwin-x64",
    binary: "resvgjs.darwin-x64.node"
  },
  "linux-arm64": {
    packageName: "@resvg/resvg-js-linux-arm64-gnu",
    binary: "resvgjs.linux-arm64-gnu.node"
  },
  "linux-x64": {
    packageName: "@resvg/resvg-js-linux-x64-gnu",
    binary: "resvgjs.linux-x64-gnu.node"
  },
  "win32-arm64": {
    packageName: "@resvg/resvg-js-win32-arm64-msvc",
    binary: "resvgjs.win32-arm64-msvc.node"
  },
  "win32-x64": {
    packageName: "@resvg/resvg-js-win32-x64-msvc",
    binary: "resvgjs.win32-x64-msvc.node"
  }
});

function hostTarget() {
  return `${process.platform}-${process.arch}`;
}

function requestedTarget() {
  const argumentIndex = process.argv.indexOf("--target");
  return argumentIndex >= 0 && process.argv[argumentIndex + 1]
    ? process.argv[argumentIndex + 1]
    : process.env.CODETOUR_TARGET || hostTarget();
}

function dependencyRoot() {
  const candidates = [
    path.join(root, "node_modules"),
    path.join(root, "packages", "description-renderer", "node_modules")
  ];
  const selected = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "@resvg", "resvg-js", "js-binding.js"))
  );
  if (!selected) {
    throw new Error(
      "Unable to find @resvg/resvg-js. Install the root and description-renderer dependencies first."
    );
  }
  return selected;
}

function prepareRuntime(target = requestedTarget()) {
  const specification = TARGETS[target];
  if (!specification) {
    throw new Error(
      `Unsupported CodeTour packaging target ${target}. Supported targets: ${Object.keys(TARGETS).join(", ")}`
    );
  }
  if (target !== hostTarget()) {
    throw new Error(
      `The ${target} artifact must be built on a ${target} Node host; current host is ${hostTarget()}. ` +
        "Build each VSIX on its matching CI runner so its native rasterizer is executable."
    );
  }

  const modulesRoot = dependencyRoot();
  const basePackage = path.join(modulesRoot, "@resvg", "resvg-js");
  const nativePackage = path.join(
    modulesRoot,
    "@resvg",
    specification.packageName.slice("@resvg/".length)
  );
  const nativeSource = path.join(nativePackage, specification.binary);
  if (!fs.existsSync(nativeSource)) {
    throw new Error(
      `Missing rasterizer binary ${nativeSource}. Run npm ci on a ${target} host before packaging.`
    );
  }

  const baseManifest = JSON.parse(
    fs.readFileSync(path.join(basePackage, "package.json"), "utf8")
  );
  if (baseManifest.version !== RESVG_VERSION) {
    throw new Error(
      `Expected @resvg/resvg-js ${RESVG_VERSION}, found ${baseManifest.version}.`
    );
  }

  const runtimeRoot = path.join(root, "dist", "resvg-runtime");
  const runtimePackage = path.join(runtimeRoot, "resvg-js");
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimePackage, { recursive: true });
  for (const file of ["index.js", "js-binding.js"]) {
    fs.copyFileSync(path.join(basePackage, file), path.join(runtimePackage, file));
  }
  fs.copyFileSync(nativeSource, path.join(runtimePackage, specification.binary));
  fs.writeFileSync(
    path.join(runtimePackage, "package.json"),
    `${JSON.stringify({ name: "@resvg/resvg-js", version: RESVG_VERSION, main: "index.js" }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "manifest.json"),
    `${JSON.stringify(
      {
        target,
        packageName: specification.packageName,
        binary: specification.binary,
        version: RESVG_VERSION
      },
      null,
      2
    )}\n`
  );

  return {
    target,
    binary: specification.binary,
    runtimeRoot
  };
}

if (require.main === module) {
  console.log(JSON.stringify(prepareRuntime(), null, 2));
}

module.exports = { TARGETS, hostTarget, prepareRuntime };
