# Standalone CodeTour distribution

The standalone distribution includes the CodeTour CLI, TermDOM dependencies, the platform-specific Mermaid rasterizer, and the official Node.js 24.18.0 runtime. End users do not need to install Node.js or have administrator privileges. Git must be available on PATH because CodeTour discovers the current Git worktree and reads historical snapshots through Git.

## Build

Build on the target OS and architecture (Windows x64, macOS Intel, or macOS Apple Silicon), using the pinned development toolchain and the normal dependency installation described in the root README:

```sh
npm ci
npm ci --prefix packages/description-renderer
npm ci --prefix packages/mcp-server
npm run build
npm run package:standalone -- --output /path/to/new/codetour-distribution
npm run test:standalone
```

On Windows provide a Windows output path such as `C:\Users\you\codetour-distribution`. The output directory must not already exist. The build needs `curl` and `tar`. It downloads the official Node runtime for the host target and verifies its pinned SHA-256 before extraction. For offline builds, set `CODETOUR_NODE_ARCHIVE` to the matching official archive; the same checksum validation is applied. When updating the Node pin in ADR 0011, update the version and all three checksums in `scripts/package-standalone.js`.

Package the output directory as a zip with all files and permissions preserved for distribution. On macOS the executable bit on both `codetour` and `node` must remain set. The bundled `NODE-LICENSE`, `RESVG-LICENSE`, CLI notices and TermDOM package licenses are part of the distribution.

## Run

From any directory inside a Git worktree, run the packaged `codetour` launcher (`codetour.cmd` on Windows):

```sh
/path/to/codetour-distribution/codetour
/path/to/codetour-distribution/codetour "Tour title" --renderer terminal
```

The default renderer opens HTML. The terminal renderer opens a separate terminal window. Neither depends on a globally installed Node runtime. The distribution uses the current OS terminal application and Git; it does not install an application or alter system configuration.

Execution can be blocked by macOS Gatekeeper, Windows security controls, or an enterprise allowlist. Obtain approval through the organization's normal software-distribution process. This project does not bypass these controls. The executable and generated launchers are not signed by this build.

## Validation status

`npm run test:standalone` builds an artifact for the running host and tests Tour discovery and HTML output with the packaged runtime. On macOS it also runs the packaged terminal reader in a pseudo-terminal and checks that a Tour Step appears and the reader exits. This does not prove the graphical terminal window works, validate Copilot, or replace testing on a fresh machine without a global runtime and without admin access. Windows and both macOS architectures each need their own actual artifact and graphical smoke test before the POC packaging acceptance criterion is complete.
