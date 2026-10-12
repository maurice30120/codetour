# Drop VS Code Web support

CodeTour targets the Node-based VS Code extension host and no longer builds or publishes a browser extension. The manifest exposes only the Node `main` entry point, the build emits the Node extension and the bundled MCP server with no Web Worker bundle, and the Web-specific desktop-integration shim and the `os-browserify`/`path-browserify` fallbacks are deleted. Packaging and CI verify that no web artifact reaches the VSIX.

Desktop VS Code remains supported locally and through remote Node extension hosts such as SSH, Dev Containers, and Codespaces; `extensionKind: ["workspace"]` is unchanged. The `isWeb` property of a tour's `when` expression context is retained and now always evaluates to `false`.
