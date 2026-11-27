# Create Tours with a skill and a local CLI, and ship no MCP server

CodeTour used to generate Tours through a stdio MCP server: the VS Code
extension registered one definition provider per workspace folder (ADR 0006),
the standalone artifact embedded the same entry behind a reserved `mcp` token
(ADR 0030), the Copilot plugin declared it in `mcp.json` (ADR 0041), and an
optional user-level registration in `~/.copilot/mcp-config.json` could duplicate
it (ADR 0034). The Tour method itself lived only in prompts served over that
transport, and the run state it wrote drove a blocking `agentStop` guard
(ADR 0042 to 0045).

We decide that **generation is a command invocation, not a session transport**:
an agent follows a shipped skill, which explores the workspace and hands one
JSON proposal to `codetour create-project-tour` or `create-changes-tour`; the CLI
validates the proposal, applies the workspace, Git, image and Mermaid rules, and
writes the `.tour` file atomically. CodeTour ships **no MCP server at all**:
no `codetour mcp` subcommand, no `packages/mcp-server/`, no `mcp-server.js`
bundle, no VS Code registration, no plugin `mcp.json` and no MCP client
configuration. Readers, manual recording, ACP conversations and
`--install`/`--uninstall`/`--agents`/`--doctor` are untouched.

**Why remove the transport.** Every surface that had to be told about a server
was a failure mode of its own: a registration that only lives while the
extension process is attached, a second copy of every tool when a user-level
entry duplicated the plugin's, a launcher that had to be verified before any
write because a stale `codetour` on `PATH` would leave the session without
tools, a 3.6 MB server bundle in the extension and the standalone artifact, and
a run-state protocol between the server, the adapter and the hook. The creation
itself is one call with one JSON answer; the transport added configuration,
packaging and identity problems to a problem that has none. Removing it also
removes the protocol-only dependencies (`@modelcontextprotocol/sdk`, the tool
input schemas), the packaging invariant that enforced a single embedded server,
and the whole class of "the server is not registered" failures.

**Why a skill rather than prompts on a server.** The Tour method has to reach
the agent before it writes anything: a step list produced first and validated
afterwards is too late, and a resource read over a transport can only be
required, never observed. A skill is read by the host as instructions, so the
method, the proposal shape, the failure handling and the critical-review pack
travel with the same document the agent is following. Both shipped skills
(`packages/copilot-plugin/skills/codetour-generate/` and
`packages/pi-plugin/skills/codetour-generate/`) are generated from one source
and carry the critical-review pack in `references/`, copied byte for byte from
`docs/critical-review/` by `scripts/embed-review-skill.js` and pinned by a test;
`docs/critical-review-skill.md` documents the route.

**Why the CLI stays.** It owns the rules that must not be re-implemented by an
agent: schema and semantic validation, workspace confinement, Git reference
policy, image and Mermaid verification, atomic writes and the creation journal
(`<workspace>/.tours/.log/creations/`). The creation rules live in
`packages/tour-generation/`, free of any transport, so the CLI is the only
caller and the rules cannot drift from a second server-side copy.

**The break is deliberate and documented.** An MCP client that used the
`codetour` server loses it: the two creation tools, the generation prompts and
the `codetour://review/critical-instructions` resource are gone, and the
`codetour` npm package is retired. `MIGRATION.md` states the break, the
replacement (`codetour --install <agent>`, then the skill; or the two creation
commands directly) and the migration of an existing installation. The
`agentStop` hook becomes purely informative: it reports the Tours the response
created, read from the creation journal, and one token reading, and never
blocks, never asks for a continuation and never changes the exit status
(spec #320).

**Migration removes only what CodeTour can prove it owns.** `--install` and
`--uninstall` of either generation agent carry the migration; no new command is
introduced. The ownership predicates are frozen literals in
`src/cli/agentMigration.ts`, because the writers they compared against no longer
exist: the two launch shapes of the retired server (`codetour mcp`, and the
absolute Node launcher with the `mcp` subcommand), the byte-exact adapter files
of the previous release, the retired on-disk run state (`codetour-run-<runId>.json`
satisfying the removed contract, with its lock) and the retired Pi launcher
shape. Anything else is reported and preserved — a modified adapter file, a
same-named server launched another way, a corrupt run state — because deleting
a file whose bytes are not ours is worse than leaving a dead one. `.tours/*.tour`,
`.tours/images/` and the creation journal are never touched, so Tours written
before this change still open. `--doctor` reports what CodeTour cannot prove or
cannot reach, including the Codex-side configuration an older release wrote
(`codex mcp remove codetour`).

**Considered and rejected.** Keeping the server for third-party MCP clients
next to the CLI (two supported routes, two sets of rules to keep aligned);
widening the ownership predicate to "a local entry whose last argument is `mcp`"
(would delete a foreign server — the reason the previous predicate compared the
whole launch contract); deleting the adapter directory by file name only (would
delete a user's edit); a new `codetour migrate` command (a third name for what
`--install`/`--uninstall` already do on the machine that needs it); serving the
critical-review pack from a packaged resource file (the skill directories must
carry it, and the embedded copies keep an offline install self-contained).

**Superseded.** This decision supersedes ADR 0030 (the standalone `codetour mcp`
entry, its webpack alias and its packaging invariant), ADR 0034 (the
`~/.copilot/mcp-config.json` registration), ADR 0041 (the plugin's single
`mcp.json` server, its served prompt as the only Tour method, and the one
guarded run it licensed), and the run-state and metrics decisions ADR 0042 to
ADR 0045: the guarded run, the continuation, the pre-launch MCP facts and the
Knowledge metrics no longer exist. ADR 0005 and ADR 0006 (run and distribute a
stdio server) are superseded in effect. ADR 0023 is retargeted: images are still
verified, at the creation boundary of `packages/tour-generation/` rather than at
an MCP boundary. ADR 0049 (the read-only launcher's `--no-mcp` suppression) and
ADR 0056 (one canonical workspace spelling, now used by the creation journal and
the hooks that read it) stay in force. Historical ADRs keep their text.
