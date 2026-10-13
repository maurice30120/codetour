# Real VS Code smoke tests

Build first with `npm run build`, then run `node scripts/run-vscode-tests.js`.
For a packaged installation run `node scripts/run-vscode-tests.js --vsix /absolute/path/to/package.vsix`.
Set `VSCODE_EXECUTABLE` or pass `--code /path/to/Electron` for another installation.

Requires Node with global fetch and WebSocket (Node 22+), an installed VS Code, and an available graphical desktop.
Profiles, extension directories, fixture tours and code are isolated under a temporary directory. User profiles and tours are never used.
Artifact mode extracts the exact VSIX into that isolated installed-extension directory; it does not use extensionDevelopmentPath.
The extension-host suite uses the real vscode module and public commands. The outer runner reads real WebView DOM over Electron CDP.
Assertions cover command registration, playback mode toggles, DOM step content, editor anchors, next, resume, and end.
This smoke test does not assert native comment-thread contents or decoration ranges: VS Code's public API does not expose them.
Logs and results remain in the printed temporary directory for diagnosis. A failed GUI launch, missing DOM or host timeout fails the run.

Extended coverage uses real DOM Edit/Save buttons and textarea input, persisted tour JSON, Mermaid PNG dimensions, managed native Markdown edits, draft close/resume, live playback settings, theme changes and actual Tab focus. Light/dark narrow-window screenshots are saved beside result.json.
