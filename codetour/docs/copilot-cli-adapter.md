# Copilot CLI plugin (experimental)

CodeTour integrates with GitHub Copilot CLI through one Agent Plugins 1.0
directory, [`packages/copilot-plugin/`](../packages/copilot-plugin/README.md).
It ships two surfaces and no server:

- the `codetour-generate` skill, which explores the workspace and creates the
  Tour with the local `codetour` CLI (`create-project-tour` /
  `create-changes-tour`), with the critical-review pack it must read for a
  critical Changes Tour in `skills/codetour-generate/references/`;
- an informative `agentStop` hook, which reports at the end of a response the
  Tours that response created and one token reading, and never blocks.

The MCP server this plugin used to declare, the `/codetour` extension it used to
be installed with, and the `mcp.json` that launched them are gone (ADR 0057).
Generation is one CLI invocation, so the plugin needs no transport, and reading
a Tour is the CLI's own job.

## Install

`codetour --install copilot` installs the plugin from the running CLI revision,
with no checkout and no network, through `copilot plugin install` so the host
owns the cache. `CODETOUR_COPILOT_PLUGIN_DIR` writes the same managed files into
a directory instead of invoking Copilot (tests and managed layouts).

The install also migrates what this release retires, and reports every file it
touches:

- the MCP-routed adapter of the previous release in
  `~/.copilot/extensions/codetour/` (`COPILOT_HOME` relocates the user
  directory, `CODETOUR_COPILOT_EXTENSIONS_DIR` overrides it), file by file and
  only when its bytes match the release that wrote it;
- the `codetour` entry of `~/.copilot/mcp-config.json`
  (`CODETOUR_COPILOT_MCP_CONFIG` overrides the path) when it matches one of the
  two launch shapes an older CodeTour CLI wrote;
- the retired `~/.copilot/skills/codetour-knowledge/` directory, so no second
  CodeTour guidance coexists with the plugin;
- the guarded run states of the current workspace
  (`<workspace>/.tours/.log/codetour-run-*.json`) that satisfy the retired
  on-disk contract, with their lock.

Everything else is preserved and reported: an edited adapter file, a foreign
file in the same directories, a same-named server launched another way, a
corrupt run state. `codetour --uninstall copilot` removes the plugin first, then
only the files this CLI owns, and prunes the directories it emptied.

The plugin requires GitHub Copilot CLI **1.0.106 or later**. On that version the
local Agent Plugins 1.0 directory is accepted (`plugin.json` with
`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`,
`com.github.copilot/` components, `skills/<name>/SKILL.md`), `${PLUGIN_ROOT}`
and `${PLUGIN_DATA}` are expanded, and the `agentStop` payload carries
`sessionId`, `timestamp`, `cwd`, `transcriptPath`, `stopReason` and
`stop_hook_active`. `copilot plugin install <dir>` is a direct/local install and
prints a deprecation warning; no marketplace is involved. `copilot plugin list`
and `copilot skill list` are the inspection surfaces.

Start `copilot --experimental` in a trusted Git worktree, with extension mode
set to Load Only or Load & Augment. GitHub's extension API remains experimental.

## Generate in a session

Invoke the skill directly, or ask for a Tour in plain language:

```text
/codetour-generate type=project Explique le flux de paiement
/codetour-generate type=changes reviewMode=critical Revue de ma branche
```

The skill resolves the choices it is missing (Project or Changes; neutral or
critical for a Changes Tour), explores the workspace, and hands one JSON
proposal to the installed CLI from the workspace root:

```sh
codetour create-project-tour --workspace "<absolute workspace root>" --proposal -
codetour create-changes-tour --workspace "<absolute workspace root>" --proposal -
```

The CLI validates the proposal, writes the `.tour` file atomically and answers
with one JSON document. A refused proposal writes nothing and reports the
`issues` to correct; the agent resubmits instead of claiming a Tour. Nothing is
started beside the CLI: no `prompts/get`, no run state, no fallback prompt. If
`codetour` is missing, the skill stops and points at
`codetour --install copilot`.

The critical-review method is part of the plugin: the
`references/changes-tour-critical.md` module the skill routes a `critical`
Changes Tour to requires reading `references/codetour-adaptation.md`,
`references/upstream-code-review.md` and `references/upstream-LICENSE.txt`, which
ship byte for byte beside the skill; a Project Tour and a neutral Changes Tour
never open that pack. See [the critical review skill](critical-review-skill.md).

## Read a Tour

Reading is the standalone CLI:

```sh
codetour "My Tour"                     # interactive terminal reader
codetour "My Tour" --renderer html     # browser page
codetour --internal-open-vscode "<tour path>"
```

The terminal reader paints the terminal it is given. In a Copilot session the
hook command is the only CodeTour process the host starts, so a reading happens
in the user's shell, not inside the session. The probe of the previous release's
terminal handoff is recorded below as a verified limit rather than a route: the
extension process never reported a TTY in print mode or under a PTY parent, its
stdin was the CLI's extension bootstrap, and the SDK declares no suspend
surface, so `/dev/tty` opened only with a PTY parent and the host TUI kept that
terminal's input and painting. Print the command, run it at the workspace root,
and the reading is the CLI's normal one.

## The agentStop hook

`com.github.copilot/hooks/hooks.json` declares one `agentStop` command:

```json
{
  "version": 1,
  "hooks": {
    "agentStop": [
      {
        "type": "command",
        "command": "node \"${PLUGIN_ROOT}/com.github.copilot/hooks/agent-stop.mjs\"",
        "timeoutSec": 10
      }
    ]
  }
}
```

The script is deterministic: no LLM, no network, no Tour write. It reads two
documents it does not own — the creation journal the CLI appends to
(`<workspace>/.tours/.log/creations/`) and the session transcript the payload
names — then prints the summary on stderr and always answers `{}` with exit 0. It
is inert when:

- the payload carries no session identity, or `stop_hook_active` is true;
- the workspace is unusable, or no creation record belongs to this session and
  this canonical workspace;
- no creation is attributed to the current response window (the last
  `user.message` at or before the stop);
- a marker at
  `<workspace>/.tours/.log/creations/.reported/<sessionId>-<responseStartMs>`
  says this window was already reported.

For an attributed response it prints one line per created Tour with its absolute
path, then one token reading for the response as a whole: `input` (which already
contains the cache, shown as a part of it), `output`, and `(approximate)` or
`unavailable` when the transcript does not support an exact figure. Never zero
for an unobserved figure, never a second reading for the same window.

The hook prints and answers nothing else: it never blocks, never asks for a
continuation and never changes the session's exit status (spec #320, DESIGN §4).

## Migration from the retired adapter

The previous release installed an extension in
`~/.copilot/extensions/codetour/` that joined the session with a `/codetour`
command, fetched a generation prompt over a stdio MCP client
(`prompts/get`), wrote `<workspace>/.tours/.log/codetour-run-<runId>.json`, and
licenced one blocking `agentStop` continuation asking for a Knowledge closure.
All of that is removed with the server it spoke to:

- there is no `/codetour` command; the plugin's skill is the generation entry
  point;
- there is no run state and no continuation; the hook is informative;
- `create_project_tour`, `create_changes_tour`, the generation prompts and the
  `codetour://review/critical-instructions` resource no longer exist as MCP
  surfaces; the CLI commands and the shipped `references/` pack replace them.

`codetour --install copilot` performs the cleanup described in **Install**.
`codetour --doctor` reports what CodeTour cannot prove it wrote, including the
Codex-side configuration an older release registered
(`codex mcp remove codetour`). See [MIGRATION.md](../MIGRATION.md) for the
user-facing break and [ADR 0057](adr/0057-create-tours-with-a-skill-and-a-local-cli-and-ship-no-mcp-server.md)
for the decision.

## Verification

Automated:

```sh
node --test test/copilot-hook.test.mjs test/copilot-plugin-install.test.mjs
```

- the hook tests pin an ordinary conversation silent, the attribution rule (same
  session, same canonical workspace, record inside the response window), one
  reading per window, the four silence cases, `stop_hook_active`, unreadable and
  foreign journal records, and a hook that always answers `{}` with exit 0;
- the real plugin test installs `packages/copilot-plugin` into a temporary
  `COPILOT_HOME` from a path containing spaces, inspects `plugin list` and
  `skill list`, asserts that no server is declared and no retired `mcp.json` is
  installed, runs the installed hook from a workspace path containing spaces,
  then uninstalls and checks the final state. It skips only when `copilot` is
  absent.

Observed on GitHub Copilot CLI 1.0.106 (bundled runtime 1.0.114), macOS,
19 November 2026, with a temporary `COPILOT_HOME`, while the previous release was
still shipped. These findings are kept as the historical record of the removed
surfaces; the current plugin is verified by the automated lanes above and the
`agentStop` summary is documented with its limits in the
[plugin README](../packages/copilot-plugin/README.md).

- Agent Plugins 1.0 installed and listed; the skill listed; the `agentStop` hook
  fired on a real session (`hook.start`/`hook.end` with `output:{}` on an
  ordinary conversation).
- One `codetour` MCP server process per session, launched with a session
  workspace path containing spaces, exposing exactly the six CodeTour tools
  (prefixed `codetour-` in the session tool catalog).
- A resumed session with an incomplete run: the hook blocked once, the re-entry
  carried `stop_hook_active:true` and was inert, and the agent saved no
  Knowledge entry; the server persisted `completed_zero`.
- `copilot -p "/codetour generate …"` does **not** dispatch an extension slash
  command; the CLI sends the text to the model, which invoked the
  `codetour-generate` skill instead.
- The terminal handoff probe described in **Read a Tour** above.

Windows was not executed here: the hook uses Node APIs without a shell, and both
installed and workspace paths containing spaces were exercised on macOS. A
previous probe of the installed extension API is recorded in
[the Copilot generation probe](copilot-generation-probe.md).

Primary API references: [GitHub SDK extensions](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md), [agent authoring](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/agent-author.md), [Copilot plugin creation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating), [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference). The installed CLI's bundled SDK declarations and schemas are the compatibility reference for the recorded probe.
