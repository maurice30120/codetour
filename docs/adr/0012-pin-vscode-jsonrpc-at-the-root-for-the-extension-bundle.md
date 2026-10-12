# Pin vscode-jsonrpc 8.2.0 at the root for the extension bundle

The extension's webpack build bundles Mermaid 11 through the `codetour-description-renderer` package, and Mermaid's Langium parser imports `vscode-jsonrpc` subpaths (`lib/common/cancellation.js`) that only exist in the 8.x layout. npm previously hoisted `vscode-jsonrpc@4.0.0` to the root to satisfy `@microsoft/servicehub-framework` (a vsls dependency), so the extension build failed with 27 module-resolution errors while the MCP server kept building because its own `node_modules` resolve 8.2.0.

The root therefore declares `vscode-jsonrpc: "8.2.0"` as an exact-pinned devDependency: npm hoists 8.2.0 to the root for Langium, and nests 4.0.0 under `@microsoft/servicehub-framework`, which keeps vsls on the version range it declares. Nothing in the repo imports this package directly; the consumer is the extension bundle's transitive Langium code. The exact pin is deliberate: relaxing it to caret style or "cleaning it up" as an unused dependency silently reintroduces the build failure.

This only steers npm's hoisting; it is not a general dependency strategy. Switching package managers (pnpm/yarn), or removing vsls and its 4.0.0 requirement, would need this re-evaluated rather than carried over.
