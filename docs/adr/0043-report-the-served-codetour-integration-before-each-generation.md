# Report the served CodeTour integration before each Copilot generation

Spec #223's trial exposed two integration hazards that hid the experiment's
meaning: the personal Copilot plugin served another checkout, and the session
ran two CodeTour surfaces while the generated Tour still looked successful.
The decision is to move these facts into view at the only moment they can
still be acted on - before the generation runs - without turning the
observation into a gate.

**Where: the adapter, before any agent request.** The agentStop guard writes
diagnostics and at most one continuation block; it is not a display surface.
The extension adapter owns the generation start and has the host's
`session.log`, so it reports six info lines right after the choices and the
orientation, before `prompts/get`: the running adapter file with its origin
(installed extension or development build), the launcher its CLI calls
resolve to, the resolved workspace, the installed extension files, the
installed plugin with its version, cache path and MCP launcher (including
the build version beside the launcher script), and the user
`mcp-config.json` declaration. The scan is offline: no `copilot` subprocess,
no network; it reads exactly the paths the installer writes
(`COPILOT_HOME`, `CODETOUR_COPILOT_*` overrides), so it cannot disagree with
the install it documents.

**Explicit problems, no blocking.** One problem is reported per hazard, at
error level, and none stops the run: a missing plugin in this home, a
launcher that does not exist, a launcher serving a different plugin.json
version than the installed metadata (stale or foreign build), a `codetour`
MCP server also declared in the user config (the plugin's server would run
twice), and duplicate CodeTour extension directories. A problem is the
user's decision to act on, not a refusal: the run's own tools and the
agentStop guard still report the truth about what actually happened, and
nothing here announces a Tour or a consolidation.

**The record travels with the run.** The same facts land in the run state's
`metrics.integration` next to the run usage metrics (ADR 0042), so the
per-`runId` trial record shows launcher, workspace, adapter origin, plugin
version and launcher build, and the problems observed at launch time for
every generation used in a comparison. A session that bypasses the wrapper
creates no run state and therefore no record; it keeps its status from ADR
0041: unguarded, without invented guarantees.

**Consequences.** A later generation on an old, moved or duplicated
integration is visible at first contact instead of being discovered in a
logbook after the fact. The scanner's tolerance is intentional: an
unreadable config, missing extension directory or unparseable launcher only
downgrades the report's confidence (present:false, launcherBuild:null); it
never blocks generation and never writes outside the run state. The session
events format remains Copilot-internal for usage (ADR 0042); the surface
scan only relies on the installer-owned paths, which are CodeTour's own
contract.
