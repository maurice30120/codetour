# Specs 77, 79 and 80: integration evidence

Validation date: 2026-10-30. Host: macOS arm64. Integration source:
`78e4a8f9b0f2f2cdb490ae9c7ad56a62d5495597`, with the artifact checks in
this document's commit. The source was built in an isolated Git worktree.
This is an evidence ledger, not a declaration that every platform acceptance
criterion is complete.

## What was exercised

| Spec | Implemented and observed | Remaining acceptance evidence |
| --- | --- | --- |
| [77](https://github.com/maurice30120/codetour/issues/77) | Shared MCP entry exposed through `codetour mcp`; real packaged macOS launcher, clean stdio, Project Tour creation outside Git, explicit workspace override, argument errors and stdin shutdown; exactly one embedded server, finite bundle budget, executable permissions and licenses. | Execute the same packaged launch/protocol/reader checks on Windows and on fresh machines without a development checkout. |
| [79](https://github.com/maurice30120/codetour/issues/79) | Narration module and V integration are present in the common CLI bundle; deterministic narration tests cover engine interaction. Packaged TermDOM startup and exit pass. | Final integrated audible macOS smoke is recorded separately below. Real Windows voice availability, interruption and runtime behavior still require a Windows machine. |
| [80](https://github.com/maurice30120/codetour/issues/80) | Optional neutral/critical MCP contract, offline skill resource, unchanged `.tour` format; complete upstream text, separate adaptation, revision and MIT license survive standalone, extracted VSIX and installed npm-package boundaries. Project and neutral/critical Changes Tour fixtures can be created and opened by both readers. | Copilot interaction and real agent handoff evidence belong to the adapter report. The packaged fixture tests do not demonstrate an LLM's review quality or spec discovery. |

The MCP remains a validator and persistence boundary. The integration scenario
acts as a fake Tour Generator: it reads instructions before authoring critical
steps and submits known proposals. It creates a Project Tour, a neutral Changes
Tour, a critical Changes Tour without a spec, then one with `docs/spec.md`.
The resulting Tours open in HTML and in real macOS pseudo-terminals. Changes
Tours preserve their base/head diff snapshots despite a later dirty edit; all
Tours remain byte-for-byte unchanged after playback. There is no `reviewMode`
field persisted in the Tour files.

## Executed checks

Commands below were prefixed with `rtk` in the agent session.

- `npm run build`: passes for renderer, MCP, extension and CLI bundles.
- `CODETOUR_NODE_ARCHIVE=/tmp/codetour-node-v24.18.0-darwin-arm64.tar.gz node --test test/standalone-package.test.js`:
  **12 passed**, including real macOS PTY playback for each generated fixture,
  offline skill-resource reads and the original single-server/size/integrity checks.
- `node scripts/run-compiled-tests.js packages/mcp-server/dist/test`:
  **162 passed**, including the installed-package fixture. This fixture builds
  an npm tarball, installs it offline in
  a consumer and reads the complete skill resource from the installed binary.
- `node_modules/.bin/vsce package --no-dependencies --target darwin-arm64 --out /tmp/codetour-cross-validation.vsix`:
  actual VSIX generated, 108 archive entries (106 files under `extension/`).
- `node scripts/verify-vsix.js /tmp/codetour-cross-validation.vsix darwin-arm64`:
  unpacked native rasterizer produces PNG; MCP starts and serves upstream text,
  adaptation, source revision and MIT license over the real stdio resource API.
- `rg -n '@github/copilot|copilot-sdk' src packages/mcp-server/src packages/description-renderer/src`:
  no matches; the common runtime does not import the Copilot SDK.

The Node archive is downloaded once and checked by the packager against its
pinned SHA-256 before extraction. Artifact execution uses the bundled Node;
the macOS smoke tests restrict `PATH` to `/usr/bin:/bin`.

## Artifact identities

These identify the source state above, before any later adapter/review fixes.
Final release candidates must be rebuilt and their identities recorded again.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS arm64 VSIX | 18,910,809 | `e5b007b643babb37a038be257643e15fc0338bb84348c47ebd4ca7980ac9e74b` |
| npm `codetour-mcp-0.1.1.tgz` | 102,299 | `5f0f505c8014b27b901cec5e0ba9c166a4301188aa32d8b494e53baa719f02b7` |
| standalone `dist/cli.js` | 6,876,947 | `d4fbc15dd292f2acedaeaa20e6eaa693c622fc1d96ffa27011978e3bf5624cd0` |
| VSIX `dist/mcp-server.js` | 3,758,569 | `0bdd62b41cd471d1bf1cab54ab77a8425c5adb873f23ed7d7d72c9f445069add` |

Temporary artifacts are validation outputs rather than published releases.

## Final integrated audio and client checks

The integration coordinator records the final macOS audible smoke and real
Copilot probe here or links their reports before claiming the corresponding
acceptance criteria. No Windows execution or Copilot generation success is
claimed by this report.
