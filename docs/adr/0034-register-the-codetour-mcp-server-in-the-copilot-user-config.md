# Register the CodeTour MCP server in the Copilot user config

The Copilot adapter needs the two creation tools (`create_project_tour`,
`create_changes_tour`) in the session's tool catalog, and until this decision
the only registration came from the extension itself: the adapter joins the
session and registers `codetour mcp` as a session-scoped MCP server. That
registration is invisible to the user and fragile — it exists only while the
extension process is attached, it depends on the extension mode and on the
session starting inside a trusted Git worktree, and it can be lost when the
extension is disabled, crashes or reloads. The failure is silent: the served
generation prompt still runs, the agent finds no CodeTour tool and stops with
"the MCP server is not registered", and the user has no configuration to
inspect or repair. GitHub Copilot reads user-level MCP servers from
`~/.copilot/mcp-config.json`, so the missing piece is a registration the user
owns, independent of the extension process.

`codetour --install copilot` now writes that registration: `mcpServers.codetour`
in the user configuration file (`COPILOT_HOME` relocates the directory,
`CODETOUR_COPILOT_MCP_CONFIG` overrides the file), with `type: "local"`,
`tools: ["*"]` and the launcher of the CLI that performed the install — the
absolute Node runtime and absolute script path when the CLI is a JavaScript
entry, otherwise its absolute path, with the documented `codetour mcp` form as
the fallback. Naming the installing CLI rather than whatever `codetour` resolves
on `PATH` is deliberate: a stale global release can lack the `mcp` command and
leave the session without tools. The launch contract is verified (`mcp
--version`) before the first write, so an unlaunchable registration refuses the
install without touching the adapter files; a failure after the adapter files
were written (the configuration write) restores their previous contents or
deletes the files this install created. Foreign servers and unknown keys in the
file are preserved. Entry identity is semantic — the local transport default,
the command, the args array and the tools array — so a reordered or
`type`-less identical entry is not rewritten. Only a missing file means "no
configuration yet": any other read error (permissions, a directory at that
path) is reported with the file path and the file is left untouched. The
uninstall removes exactly the entry this CLI writes, or the documented
`codetour mcp` launcher, and preserves a same-named server launched another
way. `--agents` and `--doctor` report the three diagnostic states this creates:
`incomplete` when the adapter is current but the registration is missing,
`outdated` when both exist but the entry points at another installation, and
`installed` only when the entry is the launcher this CLI would write now.

## Consequences

The registration names an absolute path, so moving the installation —
switching Node versions, moving the checkout, reinstalling the standalone
artifact elsewhere — invalidates it. This is accepted: the diagnostic states
name the cause and `codetour --install copilot` refreshes the entry. A
`codetour` on `PATH` is not used as the registered command, even when it works,
because the install cannot verify which release it is at session start.

The configuration is user-owned: this CLI merges one server into it, preserves
everything else byte-for-byte in the JSON sense, and refuses to rewrite a file
it cannot read. It still reads and writes without a lock, so a concurrent edit
by the user or another tool between the read and the write can be lost; the
repair command and the preserved file on every other failure keep that window
small rather than eliminating it.

There is no integrity check on the registered command. Copilot launches
whatever the absolute path holds, so any process that can rewrite the
configuration or replace the launcher at that path runs code in every Copilot
session. The verification probe proves the launcher starts and answers
`--version`; it is not a checksum, a signature or a sandbox. This CLI therefore
treats `~/.copilot/mcp-config.json` with the same trust as any other user-owned
tool configuration: it never changes the security boundary, which stays the
user's account and the filesystem permissions around it.
