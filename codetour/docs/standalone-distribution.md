# Standalone CodeTour distribution

The standalone distribution is a single artifact with one launcher and one product: `codetour` reads existing Tours (HTML or terminal) and creates new ones from a JSON proposal (`codetour create-project-tour`, `codetour create-changes-tour`). It includes the CodeTour CLI bundle, the embedded agent-integration files it installs, the TermDOM and punycode dependency closures, the platform-specific Mermaid rasterizer, and the official Node.js 24.18.0 runtime. End users do not need to install Node.js, a VS Code extension, or have administrator privileges. Git must be available on PATH because CodeTour discovers the current Git worktree and reads historical snapshots through Git; Project Tours also work before a workspace is a Git repository, but Changes Tours and historical snapshots always require Git.

## Build

Build on the target OS and architecture (Windows x64, macOS Intel, or macOS Apple Silicon), using the pinned development toolchain and the normal dependency installation described in the root README:

```sh
npm ci
npm ci --prefix packages/description-renderer
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

The default renderer is the terminal: it opens a separate terminal window. `--renderer html` opens the HTML reader in a browser page. Neither depends on a globally installed Node runtime. The distribution uses the current OS terminal application and Git; it does not install an application or alter system configuration.

### Create Tours with the packaged launcher

The same launcher creates a Tour from a JSON proposal, so an agent outside VS
Code can generate one with the skill or on its own. Nothing is served: the CLI
validates the proposal, applies the workspace, Git, image and Mermaid rules, and
writes the `.tour` file atomically.

```sh
cd /path/to/workspace
/path/to/codetour-distribution/codetour create-project-tour --workspace . --proposal proposal.json
/path/to/codetour-distribution/codetour create-changes-tour --workspace . --proposal proposal.json
```

`--workspace <dir>` is required on every creation, so nothing is written
outside the workspace you name; `--proposal` reads the document from a file, and
omitting it reads standard input. Standard output carries exactly one JSON
document — `{"ok":true,…}` with the absolute `tourPath`, or `{"ok":false,…}`
with the `issues` to correct — and standard error carries diagnostics only.
Exit codes are `0` for a created Tour, `1` for a refused proposal that wrote
nothing and `2` for a usage or IO failure. The
[creation rules](../packages/tour-generation/README.md) list the fields and the
validation.

The retired `mcp` token is now an ordinary word: a Tour titled `mcp` opens like
any other title. No MCP server ships with this artifact (ADR 0057), and
`npm run test:standalone` asserts that the artifact carries neither a server
bundle nor a server declaration.

### Install agent integrations with `codetour --install`

The same launcher registers CodeTour with AI agents through a registry of
integrations. `codetour --agents` lists every registered agent with its state
and one line of detail, and `codetour --doctor` reports the CLI's own
dependencies next to every integration. Unknown agent ids are explicit
rejections, never silent installs. The state is `absent` (the host is not
installed), `incompatible` (the host is installed but cannot hold the
integration), `not-installed`, `installed`, `outdated` or `incomplete`; an
installed integration keeps reporting its own files when its host is missing,
because they stay removable.

`codetour --install` with no value asks which agents to install: it lists the
generation agents of this delivery (Pi and Copilot CLI) with their state and
reads a numbered answer, an agent id, or both. An empty answer installs
nothing. Without an interactive terminal the command fails and names the
alternatives instead of installing everything. `codetour --install all` is
the non-interactive batch over every compatible agent, and `--install <agent>`
still names exactly one.

`codetour --install copilot` writes the Agent Plugins 1.0 plugin — the
`codetour-generate` skill with its `references/` pack and the informative
`agentStop` hook, and no server — through `copilot plugin install`, so the host
owns its cache. The plugin files travel embedded inside the CLI bundle, so the
install works from any directory with no dependency on this repository. The
install also migrates what this release retires: the MCP-routed adapter of the
previous release in `~/.copilot/extensions/codetour` (file by file, only when
its bytes match that release), the `codetour` entry of
`~/.copilot/mcp-config.json` when it matches a launch shape a CodeTour CLI
wrote, the retired `codetour-knowledge` skill and the guarded run states of the
current workspace. Everything else is preserved and reported, and
`CODETOUR_COPILOT_MCP_CONFIG` overrides the legacy configuration path.
`codetour --uninstall copilot` removes the plugin and only the files this CLI
owns, leaving any other file or server untouched. `codetour --agents` reports
the integration state, and `codetour --doctor` adds the leftovers it cannot
prove or reach, with the command that removes each of them.

`codetour --install vscode` installs the CodeTour VS Code extension through
the `code` CLI when a `.vsix` is found next to the launcher or in the current
directory (or through `CODETOUR_VSIX`), and verifies the installed extension
afterwards. `codetour --uninstall vscode` removes the extension. An absent
VS Code CLI is a clear message, not a failed command, and a host without a
distributable `.vsix` is reported as `incompatible`. The extension is a
reader integration: it stays available by name and is never part of the
generation picker.

The launcher records nothing ambient: every creation names its workspace with
`--workspace`, so a client never depends on a working directory it cannot set.
Project Tours work before the workspace is a Git repository. Changes Tours,
merge-base resolution, head validation and historical snapshots still require
Git on PATH, exactly as the reader does.

Execution can be blocked by macOS Gatekeeper, Windows security controls, or an enterprise allowlist. Obtain approval through the organization's normal software-distribution process. This project does not bypass these controls. The executable and generated launchers are not signed by this build.

## Validation status

`npm run test:standalone` builds an artifact for the running host and tests Tour discovery and HTML output with the packaged runtime, with a PATH that exposes no global Node executable on macOS. It also creates four Tours through the packaged launcher — a Project Tour, a neutral Changes Tour and two critical Changes Tours — in a workspace with and without Git, reads each of them back with the HTML renderer and the terminal reader, and checks that the creation wrote the Tour and its journal record and nothing else. It asserts that the artifact carries no server bundle and no `Usage: codetour-mcp` marker, that the critical-review pack travels inside the bundle, and that the launcher, the licenses and the executable bits are preserved. The packager still rejects an artifact whose CLI bundle exceeds the measured size budget.

On macOS it also runs the packaged terminal reader in a pseudo-terminal and checks that a Tour Step appears and the reader exits. This does not prove the graphical terminal window works, validate Copilot, or replace testing on a fresh machine without a global runtime and without admin access. Windows and both macOS architectures each need their own actual artifact and graphical smoke test before the POC packaging acceptance criterion is complete.

On Windows, `codetour.cmd` forwards every argument to `dist\cli.js` (`%*` in the launcher, covered by the launcher template test), but a real Windows launch of `codetour.cmd` for a creation has not been executed on a build machine yet: it must be validated on Windows before release, together with spaced paths through `codetour.cmd`.
