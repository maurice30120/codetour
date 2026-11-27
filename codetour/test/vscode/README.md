# Real VS Code smoke tests

Build first with `npm run build`, then run `node scripts/run-vscode-tests.js`.
For a packaged installation run `node scripts/run-vscode-tests.js --vsix /absolute/path/to/package.vsix`.
Set `VSCODE_EXECUTABLE` or pass `--code /path/to/Electron` for another installation.

Requires Node with global fetch and WebSocket (Node 22+), an installed VS Code, and an available graphical desktop.
Profiles, extension directories, fixture tours and code are isolated under a temporary directory. User profiles and tours are never used.
Artifact mode extracts the exact VSIX into that isolated installed-extension directory; it does not use extensionDevelopmentPath.
The extension-host suite uses the real vscode module and public commands. The outer runner reads real WebView DOM over Electron CDP.
Assertions cover the single expanded reading panel, opening and closing from extension commands, DOM step content, editor targets, navigation, resume and end.
The extension's internal inspection command checks its own native comment content. Decoration ranges are verified in the mocked host tests because VS Code's public API does not expose them to other extensions.
Logs and results remain in the printed temporary directory for diagnosis. A failed GUI launch, missing DOM or host timeout fails the run.

Extended coverage checks the absence of embedded navigation/editing controls, managed native Markdown editing and Save Step, persisted tour JSON, Mermaid PNG dimensions, theme changes and narrow-panel overflow. Light/dark screenshots are saved beside result.json.
