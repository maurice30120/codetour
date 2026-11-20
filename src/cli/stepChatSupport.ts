import { execFileSync } from "node:child_process";
import {
  agentCatalogueLabel,
  catalogueProfiles,
  commandExists,
  type AcpAgentProfile
} from "../agent/agentCatalogue";
import { createFallbackStepChatResponder } from "../agent/fallbackStepChatAgent";
import type { StepChatContext, StepChatResponder } from "../agent/stepChatContract";
import type { CodeTour, CodeTourStep } from "../store";
import type { ReadonlyStepContext } from "./stepContext";

/**
 * The terminal's explanation when no ACP agent is installed on the machine:
 * the catalogue, in its rank order, is the only list this sentence spells.
 */
export const NO_AGENT_INSTALLED_MESSAGE =
  `No ACP agent is installed (${agentCatalogueLabel("sentence")}).`;

export interface TerminalChatSession {
  /**
   * The first installed Agent Profile: only the preselection the panel names
   * until a session handshake confirms the agent that really answers.
   */
  profile?: AcpAgentProfile;
  /**
   * The Tour Step Conversation responder: automatic failover until the reader
   * chooses an installed Agent Profile.
   */
  responder?: StepChatResponder;
  agentNames?: readonly string[];
  selectAgent?(name: string): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * The terminal reader's Tour Step Conversation session. Only installed
 * candidates are tried, in rank order until a manual Agent Profile choice.
 * The reader starts a session when it opens the model picker or asks a question.
 */
export function openTerminalChat(
  root: string,
  options: {
    profiles?: AcpAgentProfile[];
    exists?: (command: string) => boolean;
    createResponder?: (profiles: AcpAgentProfile[]) => StepChatResponder;
    env?: NodeJS.ProcessEnv;
  } = {}
): TerminalChatSession {
  const env = options.env ?? process.env;
  const exists = options.exists ?? commandExists;
  const profiles = (options.profiles ?? configuredProfiles(root, env))
    .filter(profile => exists(profile.entry.command));
  if (!profiles.length) {
    return { dispose: async () => undefined };
  }
  let chosen: AcpAgentProfile | undefined;
  const responder = options.createResponder?.(profiles) ??
    createFallbackStepChatResponder(() => chosen ? [chosen] : profiles);
  return {
    get profile() { return chosen ?? profiles[0]; },
    responder,
    agentNames: profiles.map(profile => profile.name),
    async selectAgent(name) {
      const profile = profiles.find(candidate => candidate.name === name);
      if (!profile || profile === chosen) return;
      chosen = profile;
      await responder.dispose?.();
    },
    async dispose() {
      await responder.dispose?.();
    }
  };
}

/**
 * `CODETOUR_ACP_COMMAND` (with `CODETOUR_ACP_ARGS`) runs one explicit ACP
 * command, as the tests and an advanced reader do; `CODETOUR_ACP_PROVIDER`
 * restricts the installed Agent Profiles by name. Otherwise every launchable
 * profile on PATH is a candidate, in the catalogue's rank order.
 */
function configuredProfiles(root: string, env: NodeJS.ProcessEnv): AcpAgentProfile[] {
  const command = env.CODETOUR_ACP_COMMAND?.trim();
  if (command) {
    return [{
      name: "custom",
      entry: {
        command,
        args: (env.CODETOUR_ACP_ARGS ?? "").split(" ").filter(Boolean),
        cwd: root
      }
    }];
  }
  const only = env.CODETOUR_ACP_PROVIDER?.trim().toLowerCase();
  const profiles = catalogueProfiles(root);
  if (!only) return profiles;
  return profiles.filter(profile => profile.name.toLowerCase().includes(only));
}

/**
 * The Step context a question is grounded in: the code the reader sees, or
 * both snapshots of a diff Step. A target that cannot be read is reported as
 * unavailable rather than replaced by another file.
 */
export function buildStepChatContext(
  tour: CodeTour,
  step: CodeTourStep,
  context: ReadonlyStepContext,
  readCommitFile: (ref: string, file: string) => string | undefined = () => undefined
): StepChatContext {
  const description = step.description ?? "";
  const file = step.file || step.uri;
  if (context.kind === "code") {
    return { available: true, path: file, code: context.text ?? "", description };
  }
  if (context.kind === "diff" && step.file && tour.baseRef && tour.ref) {
    const basePath = step.baseFile || step.file;
    const original = readCommitFile(tour.baseRef, basePath);
    const modified = readCommitFile(tour.ref, step.file);
    if (original !== undefined && modified !== undefined) {
      return {
        available: true,
        path: step.file,
        diff: {
          original: { path: basePath, ref: tour.baseRef, code: original },
          modified: { path: step.file, ref: tour.ref, code: modified }
        },
        description
      };
    }
  }
  return { available: false, path: file, description };
}

/** Reads one file as it exists at a commit, or undefined when it cannot. */
export function commitFileReader(root: string): (ref: string, file: string) => string | undefined {
  return (ref, file) => {
    if (!/^[a-f0-9]{40}$/.test(ref)) return undefined;
    try {
      return execFileSync("git", ["show", ref + ":" + file.replace(/\\/g, "/")], {
        cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 20 * 1024 * 1024
      });
    } catch {
      return undefined;
    }
  };
}
