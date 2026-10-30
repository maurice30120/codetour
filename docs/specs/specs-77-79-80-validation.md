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

## Criterion-by-criterion status

Numbers below refer to each issue's numbered User Stories, except #79 whose
numbers refer to its explicit acceptance criteria. “Automated” means observed
behavior at the named process/protocol or fixture boundary; it does not stand
in for the remaining real Windows and fresh-machine checks. Adapter rows are
left for the final coordinator to update from the adapter evidence.

### #77: all 30 user stories

| # | Criterion | Status and evidence |
| --- | --- | --- |
| 1 | Standalone MCP creates Project and Changes Tours | Automated: packaged launcher creates both kinds in the integration scenario. |
| 2 | Existing reading unchanged | Automated: packaged HTML and macOS PTY playback. |
| 3 | Bundled runtime, no administrator/global Node requirement | Automated: bundled runtime with restricted macOS PATH; fresh managed-machine installation pending. |
| 4 | Same two tools and validations | Automated: tool listing plus 162 MCP process/validation tests. |
| 5 | Non-Git Project Tour workspace | Automated: real packaged non-Git creation. |
| 6 | Changes comparison, head and persisted snapshots | Automated: MCP suite plus packaged dirty-worktree HTML/diff/PTY scenario. |
| 7 | Default workspace is cwd | Automated: packaged cwd test and MCP CLI workspace tests. |
| 8 | Explicit workspace root | Automated: packaged override from an unrelated cwd. |
| 9 | Stable launcher/argument contract | Implemented and exercised through `codetour mcp`; documented configuration. |
| 10 | Help describes workspace and options | Automated: packaged help output and MCP CLI tests. |
| 11 | MCP version | Automated: packaged version matches package manifest. |
| 12 | Invalid argument diagnostics/nonzero exit | Automated: packaged unknown/missing argument cases. |
| 13 | Protocol-only stdout | Automated: raw handshake parses every stdout line as JSON-RPC. |
| 14 | Startup diagnostics use stderr | Automated: argument/workspace error assertions. |
| 15 | Exit on stdin closure | Automated: real child process exit after handshake and EOF. |
| 16 | Missing/unreadable workspace | Automated missing-directory case and accessible-directory validation; actual managed ACL denial pending. |
| 17 | Realpath/confinement/offline behavior | Shared unchanged server; MCP suite rejects escaping paths/symlinks; packaged offline resource read. |
| 18 | Writes confined to workspace | Automated: only reserved Tour file appears in the packaged workspace; existing confinement tests. |
| 19 | One shared server implementation | Implemented shared `runMcpCli`; both packaged and npm entrypoints exercised. |
| 20 | Single standalone server copy | Automated artifact invariant and deliberate duplicate rejection. |
| 21 | VS Code registration/Codex configure unchanged | No registration/configuration code changed by #77; actual editor-session smoke pending. |
| 22 | npm binary compatibility | Automated offline install of tarball, two tool calls and full skill-resource read. |
| 23 | Artifact handshake without global Node | Automated packaged launcher, restricted macOS PATH. |
| 24 | Windows launcher argument forwarding | Automated launcher-template `%*` assertion; real Windows artifact execution pending. |
| 25 | macOS permissions and licenses | Automated artifact executable bits and NODE/RESVG/bundle license presence. |
| 26 | Reserved `mcp` token, Tour still selectable | Existing compiled CLI regression covers dispatch and interactive Tour selection. |
| 27 | Client configuration examples | Implemented in `docs/standalone-distribution.md` and README. |
| 28 | Thin future adapter contract | Shared documented `codetour mcp` process entry; adapters remain client-owned. |
| 29 | Measured budget and duplicate rejection | Automated actual bundle under 8,000,000 bytes and failing oversized/duplicate fixtures. |
| 30 | Plain terminal, no VS Code | Automated packaged MCP and reader subprocesses without an editor host. |

### #79: all 10 acceptance criteria

| # | Criterion | Status and evidence |
| --- | --- | --- |
| 1 | New session OFF and silent | Controller default and reader integration tests; packaged playback runs without enabling audio. |
| 2 | V starts/stops default local voice | Implemented V binding and fake-engine toggle tests; final audible macOS check pending below, real Windows pending. |
| 3 | Navigation replaces current speech | Deterministic controller cancellation/replacement tests; physical OS interruption remains platform smoke evidence. |
| 4 | Rapid navigation/slow startup race protection | Controller generation-token tests; final integrated reader race checks recorded by coordinator. |
| 5 | Redraw/scroll/chat do not restart; typed V preserved | Reader integration owns actual step-change notification outside rendering; final reader tests recorded by coordinator. |
| 6 | Markdown substitutions preserve order | `prepareText` deterministic mixed-content fixture covers prose, Mermaid, images and code. |
| 7 | Closing stops speech/cleans up | Controller/process lifecycle tests; real OS interruption/terminal closure remains smoke evidence. |
| 8 | Missing/failed TTS nonblocking | Fake-engine error paths and unsupported-platform behavior; final reader diagnostic checks recorded by coordinator. |
| 9 | Deterministic adapter tests | Fake local speech tests cover preparation, cancellation, replacement and errors without speakers/network. |
| 10 | CLI/TermDOM/schema/creation regression safety | Packaged 12-test suite and MCP 162-test suite pass; final full reader suite recorded by coordinator. |

Cross-platform support remains conditional on the spec's explicit real-Windows
smoke requirement. Controller tests alone do not satisfy that requirement.

### #80: all 13 user stories and distribution/interaction decisions

| # | Criterion | Status and evidence |
| --- | --- | --- |
| 1 | `/codetour` Lire/Générer entry | Adapter implementation/fake-host and real-client evidence to be supplied by adapter report. |
| 2 | Lire retains discovery/playback | Packaged readers verified; adapter path evidence belongs to adapter report. |
| 3 | Choose Project or Changes Tour | Both MCP tool paths exercised; adapter selection evidence belongs to adapter report. |
| 4 | Project generation unchanged, no mode question | MCP rejects unknown reviewMode for Project; fake-host no-question check belongs to adapter report. |
| 5 | Mode chosen before analysis | Critical resource is consumed before known proposals in fake-generator tests; adapter ordering/real handoff evidence belongs to adapter report. |
| 6 | Neutral generation compatible | Existing no-reviewMode calls and explicit neutral calls pass MCP and packaged creation/playback. |
| 7 | Critical findings at motivating code | MCP fake-generator tests retain factual explanations and valid changed-file anchors; packaged critical Tour playback passes. |
| 8 | Standards without spec | Embedded adaptation mandates it; critical no-spec fake-generator scenario passes. |
| 9 | Found-spec findings | MCP fake-generator scenario cites found spec, preserves separate Standards/Spec labels and valid anchors. |
| 10 | No-spec continues with explicit omission | MCP fake-generator and packaged no-spec scenario produce valid Tours with omission statement. |
| 11 | Useful factual tour without invented defects | Dedicated no-defect fake-generator scenario passes; no claim of actual model review accuracy. |
| 12 | Shared core independent of Copilot | No Copilot SDK import in common source; resource served by npm/VSIX/standalone without Copilot. |
| 13 | Preserve format/Git/diffs/guards | MCP 162 tests and four packaged generation/playback scenarios; reviewMode is never persisted. |
| D1 | Exactly two modes, explicit mode/cancellation rules | MCP validates neutral/critical only; adapter choice/cancellation evidence belongs to adapter report. |
| D2 | Upstream/adaptation/revision/MIT offline in all distributions | Verified complete resource over real installed npm, extracted VSIX and standalone stdio; actual Windows packaging pending. |
| D3 | Instructions reach agent before step authoring | Shared resource and guidance implemented; fake-generator order exercised; real Copilot handoff requires adapter evidence. |
| D4 | No copied skill/business logic in client adapter | Skill source remains solely in MCP package; adapter implementation review must confirm final client changes. |
| D5 | External direct MCP calls cannot guarantee a mode dialog | Compatibility preserved by optional neutral default; documented limit, not a server-enforced interaction. |
| D6 | Real experimental SDK feasibility probe | Adapter report must name installed version, observed handoff capabilities and any blocker; simulations alone do not complete this row. |

## Executed checks

Commands below were prefixed with `rtk` in the agent session.

- `npm run build`: passes for renderer, MCP, extension and CLI bundles.
- `node_modules/.bin/tsc -p tsconfig.test.json` followed by
  `node --test dist/test/cli/cli.test.js`: **14 passed**, including reserved
  `mcp` selection, argument forwarding and reader compatibility.
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
