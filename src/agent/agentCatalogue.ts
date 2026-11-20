import type * as acp from "@agentclientprotocol/sdk";
import { accessSync, constants } from "node:fs";
import * as path from "node:path";
import type { AcpAgentEntry } from "./acpAgentProcess";
import { findModelSelector, type AcpModelValue } from "./acpModelOptions";
import { piAcpEntry } from "./piReadonlyLauncher";
import { vibeAcpEntry } from "./vibeAcpEntry";

/**
 * The Agent Catalogue: the one owner of the Agent Profiles CodeTour knows,
 * their probed availability and the current selection (ADR 0048).
 *
 * Nothing else decides those rules, and nothing here touches the VS Code API
 * or starts a process: the Agent Probe is injected, the catalogue is a
 * versioned constant, and no state outlives the reading panel that asked for
 * it. The word "provider" is gone from this layer: a profile is a catalogue
 * entry, a provider would be the instance actually launched.
 */

/** One Agent Profile of the catalogue, and how it is launched in a workspace. */
export interface AgentProfile {
  /** The Agent Profile name, as the reader sees it. */
  name: string;
  /**
   * Explicit, versioned rank: the lowest rank answers first. Rank decides,
   * never a discovery order and never a remote registry.
   */
  rank: number;
  /**
   * The ACP entry launching this profile in the given workspace, or
   * undefined when it cannot be launched here: such a profile reports a
   * connection error and is never started unrestricted (#253).
   */
  entry(cwd: string): AcpAgentEntry | undefined;
}

/** A launchable Agent Profile, its entry already resolved for one workspace. */
export interface AcpAgentProfile {
  name: string;
  entry: AcpAgentEntry;
}

/** The versioned catalogue, in explicit rank order. */
export const AGENT_CATALOGUE: readonly AgentProfile[] = [
  {
    name: "Copilot",
    rank: 0,
    entry: cwd => ({
      command: "copilot",
      args: ["--acp", "--stdio", "--available-tools=view,grep,glob", "--disable-builtin-mcps"],
      cwd,
      useDefaultMode: true
    })
  },
  { name: "Vibe", rank: 1, entry: cwd => vibeAcpEntry(cwd) },
  // Pi only ever runs behind CodeTour's read-only launcher (ADR 0049): where
  // that launcher cannot be provided, the entry is undefined, so the profile
  // reports a connection error instead of starting an unrestricted Pi.
  { name: "Pi", rank: 2, entry: cwd => piAcpEntry(cwd) },
  {
    name: "Codex",
    rank: 3,
    entry: cwd => ({ command: "codex-acp", cwd, modeId: "read-only" })
  },
  {
    name: "Claude Code",
    rank: 4,
    entry: cwd => ({ command: "claude-agent-acp", cwd, modeId: "plan" })
  }
];

/**
 * The Agent Catalogue in rank order, as the reader-facing chrome spells it:
 * `Copilot → Vibe → Pi → Codex → Claude Code` in a parenthetical, or
 * `Copilot, Vibe, Pi, Codex or Claude Code` in a sentence. The one place the
 * order of a user-visible list is written.
 */
export function agentCatalogueLabel(style: "arrow" | "sentence" = "arrow"): string {
  const names = [...AGENT_CATALOGUE]
    .sort((left, right) => left.rank - right.rank)
    .map(profile => profile.name);
  return style === "arrow"
    ? names.join(" → ")
    : names.length > 1
      ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
      : names.join("");
}

/** Every launchable catalogue profile for a workspace, in rank order. */
export function catalogueProfiles(cwd: string): AcpAgentProfile[] {
  return [...AGENT_CATALOGUE]
    .sort((left, right) => left.rank - right.rank)
    .flatMap(profile => {
      const entry = profile.entry(cwd);
      return entry ? [{ name: profile.name, entry }] : [];
    });
}

/**
 * The availability of one Agent Profile: what the last Agent Probe of the
 * panel established, or what can be said without probing it.
 */
export type AgentAvailability =
  | { state: "unknown" }
  | { state: "not-installed" }
  /** Installed, never probed: visible, never selected automatically. */
  | { state: "unverified" }
  | { state: "auth-required"; authMethods: acp.AuthMethod[] }
  | { state: "available"; configOptions: acp.SessionConfigOption[] }
  | { state: "connection-error"; reason: string };

/** What one Agent Probe of one profile established. */
export interface AgentProbeOutcome {
  availability: AgentAvailability;
  /** The configuration options the probe's session announced. */
  configOptions?: acp.SessionConfigOption[];
  /** The authentication methods the probe's `initialize` announced. */
  authMethods?: acp.AuthMethod[];
}

/**
 * One bounded Agent Probe: `initialize` then `session/new`, disposing the
 * session as soon as it answers. Injected, so the catalogue's rules are
 * tested in-process without launching an agent.
 */
export type AgentProbe = (
  profile: AgentProfile,
  cwd: string
) => Promise<AgentProbeOutcome>;

/** One catalogue profile as a reading surface displays it. */
export interface AgentProfileView {
  profile: AgentProfile;
  availability: AgentAvailability;
  /** True for the profile that answers right now. */
  selected: boolean;
}

/**
 * True for a profile the reader may pick by hand: everything but a profile
 * that is not on the machine. A profile waiting for authentication or in
 * connection error stays selectable — a slow start does not prove it broken.
 */
export function isSelectable(availability: AgentAvailability): boolean {
  return availability.state !== "not-installed";
}

export interface AgentSelectionOptions {
  /** The catalogue to operate on; the versioned one when omitted. */
  profiles?: readonly AgentProfile[];
  /** The Agent Probe establishing each profile's availability. */
  probe: AgentProbe;
}

/**
 * The availability, probe cache and current selection of one reading panel
 * (ADR 0048).
 *
 * At panel opening the profiles are probed sequentially in rank order and the
 * probe stops at the first `available` one; the profiles after it are only
 * classified by executable presence, without being started. Copilot answers
 * whenever it is available, otherwise the first available profile by rank;
 * `not-installed`, `unverified`, `unknown`, `auth-required` and
 * `connection-error` never answer automatically.
 *
 * The reader's explicit choice replaces that automatic selection for the rest
 * of the panel: nothing probed, refreshed or failing afterwards ever replaces
 * it, and a question is only offered to the chosen profile.
 *
 * The reader's model choice is remembered per Agent Profile for the life of
 * the panel and replayed on every session that profile opens, because model
 * identifiers belong to one agent. It is forgotten as soon as the profile
 * stops announcing the value, so the selector never shows a model the agent
 * does not have.
 *
 * Nothing survives the panel: an instance holds no process, and disposing it
 * forgets everything it established.
 */
export class AgentSelection {
  private readonly catalogue: readonly AgentProfile[];
  private readonly probe: AgentProbe;
  private readonly availability = new Map<string, AgentAvailability>();
  /** The authentication methods each probed profile's `initialize` announced. */
  private readonly methods = new Map<string, acp.AuthMethod[]>();
  private selectedName: string | undefined;
  private explicitName: string | undefined;
  /** The reader's model choice per Agent Profile name, for the panel only. */
  private readonly modelChoices = new Map<string, string>();
  private settled = false;
  private started = false;
  private probing: Promise<void> | undefined;

  constructor(options: AgentSelectionOptions) {
    this.catalogue = [...(options.profiles ?? AGENT_CATALOGUE)].sort(
      (left, right) => left.rank - right.rank
    );
    this.probe = options.probe;
  }

  /** The catalogue with each profile's current availability. */
  profiles(): readonly AgentProfileView[] {
    return this.catalogue.map(profile => ({
      profile,
      availability: this.availabilityOf(profile.name),
      selected: profile.name === this.selectedName
    }));
  }

  /** The profile that answers by default, or undefined when none is usable. */
  selectedProfile(): AgentProfileView | undefined {
    return this.profiles().find(view => view.selected);
  }

  /** One catalogue profile by name, or undefined when it is not catalogued. */
  profile(name: string): AgentProfile | undefined {
    return this.catalogue.find(candidate => candidate.name === name);
  }

  /**
   * The authentication methods the profile's last Agent Probe announced,
   * kept next to its state: they are how the reader's own `Sign in` action
   * learns what the agent can be connected with. A profile that was never
   * probed announces nothing.
   */
  authMethods(name: string): acp.AuthMethod[] {
    return this.methods.get(name) ?? [];
  }

  /** The profile the reader chose by hand, or undefined while automatic. */
  explicitSelection(): AgentProfileView | undefined {
    return this.explicitName === undefined
      ? undefined
      : this.profiles().find(view => view.profile.name === this.explicitName);
  }

  /** True once the reader chose the answering profile by hand. */
  hasExplicitSelection(): boolean {
    return this.explicitName !== undefined;
  }

  /**
   * The reader's model choice for one Agent Profile, or undefined: it is
   * replayed on every new session of that profile and dropped as soon as the
   * profile stops announcing the value.
   */
  modelFor(name: string): string | undefined {
    return this.modelChoices.get(name);
  }

  /** The model chosen for the profile that answers, or undefined. */
  selectedModel(): string | undefined {
    const selected = this.selectedName;
    return selected === undefined ? undefined : this.modelChoices.get(selected);
  }

  /**
   * The model one Agent Profile's probed session announced as its current
   * value, or undefined: the honest preselection before any conversation
   * session exists, never a model the agent does not have.
   */
  announcedModel(name: string): string | undefined {
    const availability = this.availabilityOf(name);
    return availability.state === "available"
      ? findModelSelector(availability.configOptions)?.value
      : undefined;
  }

  /**
   * The model values one Agent Profile's probed availability announces — the
   * only list the reader may choose from, groups flattened. Empty when the
   * agent announces no model, or has not been probed yet.
   */
  modelOptions(name: string): readonly AcpModelValue[] {
    const availability = this.availabilityOf(name);
    return availability.state === "available"
      ? findModelSelector(availability.configOptions)?.values ?? []
      : [];
  }

  /**
   * Remembers the reader's model choice for one Agent Profile; undefined
   * forgets it, so the agent decides alone again.
   */
  chooseModel(name: string, value: string | undefined): void {
    if (value === undefined) {
      this.modelChoices.delete(name);
    } else {
      this.modelChoices.set(name, value);
    }
  }

  /**
   * Records what an Agent Profile's open session confirms about its model:
   * the values the agent announces and the value it holds now. A remembered
   * choice the profile no longer announces is forgotten — the display follows
   * the agent — while a choice it does announce is replayed at the next
   * session, even after the agent switched to another of its values.
   */
  recordEffective(
    name: string,
    value: string | undefined,
    offered: readonly AcpModelValue[]
  ): void {
    const chosen = this.modelChoices.get(name);
    if (chosen === undefined || chosen === value) {
      return;
    }
    if (!offered.some(option => option.value === chosen)) {
      this.modelChoices.delete(name);
    }
  }

  /**
   * Chooses the answering profile by hand. Any catalogue profile that is not
   * `not-installed` may be chosen — a profile waiting for authentication or
   * in connection error included — and the choice is final for the panel.
   */
  select(name: string): void {
    const profile = this.catalogue.find(candidate => candidate.name === name);
    if (!profile || !isSelectable(this.availabilityOf(profile.name))) {
      return;
    }
    this.explicitName = profile.name;
    this.selectedName = profile.name;
  }

  /**
   * The profiles a question may try, in order: an explicit choice alone,
   * otherwise the selected one first and then — only before the first answer
   * settled — the other available profiles by rank, so the initial automatic
   * selection alone may fall through. An unverified profile never answers.
   */
  candidates(cwd: string): AcpAgentProfile[] {
    const selected = this.selectedProfile();
    if (!selected) {
      return [];
    }
    const candidates = [launchable(selected.profile, cwd)].filter(
      (candidate): candidate is AcpAgentProfile => candidate !== undefined
    );
    if (this.hasExplicitSelection() || this.started) {
      return candidates;
    }
    for (const view of this.profiles()) {
      if (view.selected || view.availability.state !== "available") continue;
      const candidate = launchable(view.profile, cwd);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  /** True once an Agent Probe settled: before that, no state is final. */
  initialProbeSettled(): boolean {
    return this.settled;
  }

  /**
   * Resolves when the initial Agent Probe settled: a question asked while it
   * runs waits for it instead of starting on an unverified profile.
   */
  whenInitialProbeSettled(): Promise<void> {
    return this.probing ?? Promise.resolve();
  }

  /**
   * Establishes every profile's availability at panel opening: a cheap
   * classification by executable presence first, then the Agent Probe
   * sequentially in rank order, stopping at the first `available` profile.
   */
  probeInitial(cwd: string): Promise<void> {
    // Re-probing refreshes the states; an explicit choice and the profile
    // that already answered are never replaced by a later probe.
    const retained = this.explicitName ?? (this.started ? this.selectedName : undefined);
    this.availability.clear();
    this.methods.clear();
    this.selectedName = retained;
    this.settled = false;
    const run = this.run(cwd, {
      classify: true,
      // An explicit choice leaves nothing automatic to decide: the whole
      // catalogue is probed, so every listed state stays honest.
      stopAtFirstAvailable: !this.hasExplicitSelection()
    });
    this.probing = run;
    return run;
  }

  /**
   * Probes the profiles still `unverified`, once — what opening the agent
   * selector asks for. The automatic selection follows the refreshed states
   * while the first answer has not settled; after it, the profile that
   * answered is kept.
   */
  async probeUnverified(cwd: string): Promise<void> {
    await this.whenInitialProbeSettled();
    const run = this.run(cwd, { classify: false, stopAtFirstAvailable: false });
    this.probing = run;
    await run;
  }

  /** Clears the panel's cache and probes the catalogue again. */
  refresh(cwd: string): Promise<void> {
    return this.probeInitial(cwd);
  }

  /**
   * Re-establishes one profile — what the reader's own `Sign in` action asks
   * for after connecting that agent. Every other probed state stays as it was,
   * the reader's explicit choice and the profile that already answers are kept,
   * and a panel that had no usable profile gains the one that just answered.
   */
  async probeProfile(name: string, cwd: string): Promise<void> {
    const profile = this.profile(name);
    if (!profile) return;
    await this.whenInitialProbeSettled();
    this.record(profile.name, await this.probeOnce(profile, cwd));
    // Only a panel with nothing to answer with may gain an agent here: a
    // single profile's sign in never replaces who already answers.
    if (this.selectedName === undefined) {
      this.selectedName = automaticSelection(this.profiles())?.profile.name;
    }
  }

  /**
   * Records that the first answer settled: the automatic selection is over,
   * so a later failure retries the same profile instead of falling through.
   */
  hasConversationStarted(): void {
    this.started = true;
  }

  /**
   * Records that one Agent Profile failed while answering: its availability
   * becomes a connection error carrying the failure's reason. Nothing is
   * probed — a conversation failure never starts one — every other cached
   * state stays as it was, and neither the reader's choice nor the profile
   * that answers is replaced.
   */
  degrade(name: string, reason: string): void {
    if (!this.catalogue.some(profile => profile.name === name)) {
      return;
    }
    this.availability.set(name, { state: "connection-error", reason });
  }

  /** Forgets everything this panel probed, the reader's model choices included. */
  dispose(): void {
    this.availability.clear();
    this.modelChoices.clear();
    this.methods.clear();
    this.selectedName = undefined;
    this.explicitName = undefined;
    this.settled = false;
    this.started = false;
    this.probing = undefined;
  }

  /**
   * Forgets every model choice an available profile no longer announces. A
   * profile the probe could not start keeps its choice: its offers are simply
   * unknown, which is not the same as gone.
   */
  private dropUnannouncedModels(): void {
    for (const [name, chosen] of [...this.modelChoices]) {
      if (this.availabilityOf(name).state !== "available") continue;
      if (!this.modelOptions(name).some(option => option.value === chosen)) {
        this.modelChoices.delete(name);
      }
    }
  }

  private availabilityOf(name: string): AgentAvailability {
    return this.availability.get(name) ?? { state: "unknown" };
  }

  private async run(
    cwd: string,
    options: { classify: boolean; stopAtFirstAvailable: boolean }
  ): Promise<void> {
    if (options.classify) {
      // Every profile is classified cheaply first, so the ones after the
      // first available one already have an honest state without a process.
      for (const profile of this.catalogue) {
        this.availability.set(profile.name, classify(profile, cwd));
      }
    }
    for (const profile of this.catalogue) {
      if (this.availabilityOf(profile.name).state !== "unverified") continue;
      this.record(profile.name, await this.probeOnce(profile, cwd));
      if (
        options.stopAtFirstAvailable &&
        this.availabilityOf(profile.name).state === "available"
      ) {
        break;
      }
    }
    this.settled = true;
    this.probing = undefined;
    this.dropUnannouncedModels();
    if (this.explicitName !== undefined) {
      this.selectedName = this.explicitName;
    } else if (!this.started) {
      this.selectedName = automaticSelection(this.profiles())?.profile.name;
    }
  }

  private async probeOnce(
    profile: AgentProfile,
    cwd: string
  ): Promise<AgentProbeOutcome> {
    try {
      return await this.probe(profile, cwd);
    } catch (error) {
      return {
        availability: {
          state: "connection-error",
          reason: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private record(name: string, outcome: AgentProbeOutcome): void {
    const { availability } = outcome;
    if (outcome.authMethods !== undefined) {
      this.methods.set(name, outcome.authMethods);
    }
    if (availability.state === "available") {
      this.availability.set(name, {
        state: "available",
        configOptions: outcome.configOptions ?? availability.configOptions
      });
    } else if (availability.state === "auth-required") {
      this.availability.set(name, {
        state: "auth-required",
        authMethods: outcome.authMethods ?? availability.authMethods
      });
    } else {
      this.availability.set(name, availability);
    }
  }
}

/** What can be said about a profile without starting it. */
function classify(profile: AgentProfile, cwd: string): AgentAvailability {
  const entry = profile.entry(cwd);
  if (!entry) {
    return {
      state: "connection-error",
      reason: "This agent has no launcher on this platform."
    };
  }
  return commandExists(entry.command)
    ? { state: "unverified" }
    : { state: "not-installed" };
}

function launchable(
  profile: AgentProfile,
  cwd: string
): AcpAgentProfile | undefined {
  const entry = profile.entry(cwd);
  return entry ? { name: profile.name, entry } : undefined;
}

/**
 * The automatic selection: the first available profile by rank — Copilot
 * whenever it is available, because its rank is 0. Nothing else qualifies.
 */
function automaticSelection(
  views: readonly AgentProfileView[]
): AgentProfileView | undefined {
  return views.find(view => view.availability.state === "available");
}

/** True when a command is an executable on PATH (or a path to one). */
export function commandExists(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return isExecutable(command, platform);
  }
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      if (isExecutable(path.join(directory, command + extension), platform)) {
        return true;
      }
    }
  }
  return false;
}

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
