# Node extension release qualification

CodeTour is packaged as a Node extension for desktop VS Code and desktop VS Code
remote workspaces. VS Code Web is intentionally unsupported.

## Platform targets

Each VSIX contains the native `@resvg/resvg-js` runtime for the host that built
it. The supported targets are:

| Host target | Native package |
| --- | --- |
| `darwin-arm64` / `darwin-x64` | macOS arm64 / x64 |
| `linux-arm64` / `linux-x64` | Linux arm64 / x64 (glibc) |
| `win32-arm64` / `win32-x64` | Windows arm64 / x64 |

The packaging command refuses to produce a target different from the current
Node host. This prevents accidentally shipping a native binary that cannot be
loaded by the target platform.

## Local qualification

From a clean checkout, install the root, renderer, and MCP dependencies, then
run:

```sh
npm ci
npm ci --prefix packages/description-renderer
npm ci --prefix packages/mcp-server
npm run package
```

`npm run package` builds the renderer and MCP server, stages only the selected
rasterizer runtime, creates `codetour-<target>-<version>.vsix`, extracts it into
a temporary directory, renders an SVG through the unpacked native binary, and
starts the unpacked MCP server with `--version`. It also rejects a browser
manifest, the removed `extension-web` artifact, missing binaries, oversized
archives, and unexpectedly large file counts.

The CI workflow runs this qualification on macOS, Ubuntu, and Windows and
uploads one target-specific VSIX per runner. The release workflow packages and
publishes the same three platform artifacts independently.

Before a release, manually verify a local desktop workspace and one remote Node
workspace with all five supported Mermaid diagram types. Switch between light
and dark themes while a diagram is visible and confirm the rendered image is
refreshed. No browser or Web Worker artifact should be present.
