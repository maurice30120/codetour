import { test } from "node:test";
import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import {
  AGENT_CATALOGUE,
  AgentSelection,
  catalogueProfiles,
  isSelectable,
  type AgentAvailability,
  type AgentProfile,
  type AgentProfileView
} from "./agentCatalogue";
import { createFallbackStepChatResponder } from "./fallbackStepChatAgent";
import { StepChatAgentUnavailableError } from "./stepChatContract";

/**
 * The catalogue's rules are tested in-process: the Agent Probe is injected,
 * so rank order, the stop at the first available profile, the 5 s exclusion,
 * the panel cache and the automatic selection need no agent to be launched.
 */

/** An executable that exists on every platform the suite runs on. */
const INSTALLED = process.execPath;
/** A command no test machine has, so the profile is only not installed. */
const ABSENT = "codetour-absent-agent";

function agentProfile(name: string, rank: number, command: string): AgentProfile {
  return { name, rank, entry: cwd => ({ command, cwd }) };
}

const COPILOT = agentProfile("Copilot", 0, INSTALLED);
const VIBE = agentProfile("Vibe", 1, INSTALLED);
const CODEX = agentProfile("Codex", 2, INSTALLED);
const CLAUDE = agentProfile("Claude Code", 3, INSTALLED);
const CATALOGUE = [COPILOT, VIBE, CODEX, CLAUDE];

interface ScriptedProbe {
  calls: string[];
  probe: (profile: AgentProfile, cwd: string) => Promise<{
    availability: AgentAvailability;
    configOptions?: { id: string; name: string; type: "select"; currentValue: string; options: [] }[];
    authMethods?: { id: string; name: string }[];
  }>;
}

/** A probe that answers per profile name and records who it was asked about. */
function scriptedProbe(
  outcomes: Record<string, AgentAvailability>
): ScriptedProbe {
  const calls: string[] = [];
  return {
    calls,
    probe: async (profile: AgentProfile) => {
      calls.push(profile.name);
      return {
        availability: outcomes[profile.name] ?? {
          state: "available",
          configOptions: []
        }
      };
    }
  };
}

function view(views: readonly AgentProfileView[], name: string): AgentProfileView {
  const found = views.find(candidate => candidate.profile.name === name);
  assert.ok(found, `${name} is part of the catalogue`);
  return found;
}

test("the catalogue is a versioned constant in explicit rank order", () => {
  assert.deepEqual(AGENT_CATALOGUE.map(profile => profile.name), [
    "Copilot",
    "Vibe",
    "Codex",
    "Claude Code"
  ]);
  assert.deepEqual(AGENT_CATALOGUE.map(profile => profile.rank), [0, 1, 2, 3]);
  assert.deepEqual(
    AGENT_CATALOGUE.map(profile => profile.entry("/workspace")?.command),
    ["copilot", "vibe-acp", "codex-acp", "claude-agent-acp"]
  );

  // Rank, not declaration order, decides the launchable list.
  const launchable = catalogueProfiles("/workspace");
  assert.deepEqual(launchable.map(profile => profile.name), [
    "Copilot",
    "Vibe",
    "Codex",
    "Claude Code"
  ]);
  assert.ok(launchable.every(profile => profile.entry.cwd === "/workspace"));
  assert.ok(launchable[0].entry.args?.includes("--available-tools=view,grep,glob"));
  assert.equal(launchable[0].entry.useDefaultMode, true);
  assert.equal(launchable[2].entry.modeId, "read-only");
  assert.equal(launchable[3].entry.modeId, "plan");
});

test("the initial probe follows rank order and stops at the first available profile", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({
    profiles: [
      CLAUDE,
      CODEX,
      agentProfile("Copilot", 0, ABSENT),
      VIBE
    ],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");

  // Vibe is the first available one: the profiles after it are only
  // classified by executable presence, never started.
  assert.deepEqual(probe.calls, ["Vibe"]);
  const views = selection.profiles();
  assert.equal(view(views, "Copilot").availability.state, "not-installed");
  assert.equal(view(views, "Vibe").availability.state, "available");
  assert.equal(view(views, "Codex").availability.state, "unverified");
  assert.equal(view(views, "Claude Code").availability.state, "unverified");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Vibe"]
  );
  selection.dispose();
});

test("Copilot answers whenever it is really available", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });

  await selection.probeInitial("/workspace");

  // The probe stops at Copilot, the highest rank: no other agent is started.
  assert.deepEqual(probe.calls, ["Copilot"]);
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  assert.equal(
    selection.profiles().filter(candidate => candidate.selected).length,
    1,
    "exactly one profile is selected"
  );
  selection.dispose();
});

test("a slow or unauthenticated Copilot never wins the automatic selection", async () => {
  // A timeout is a connection error, and an authentication request is read
  // from the ACP error code: neither is selectable automatically.
  const probe = scriptedProbe({
    Copilot: {
      state: "connection-error",
      reason: "The agent did not answer the probe within 5 s."
    },
    Vibe: { state: "auth-required", authMethods: [{ id: "vibe-login", name: "Vibe login" }] },
    Codex: { state: "available", configOptions: [] }
  });
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });

  await selection.probeInitial("/workspace");

  assert.deepEqual(probe.calls, ["Copilot", "Vibe", "Codex"]);
  const views = selection.profiles();
  assert.deepEqual(view(views, "Copilot").availability, {
    state: "connection-error",
    reason: "The agent did not answer the probe within 5 s."
  });
  assert.deepEqual(view(views, "Vibe").availability, {
    state: "auth-required",
    authMethods: [{ id: "vibe-login", name: "Vibe login" }]
  });
  assert.equal(view(views, "Claude Code").availability.state, "unverified");
  assert.equal(selection.selectedProfile()?.profile.name, "Codex");
  selection.dispose();
});

test("no usable agent leaves the catalogue without a selection or a candidate", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({
    profiles: [agentProfile("Copilot", 0, ABSENT), agentProfile("Vibe", 1, ABSENT)],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");

  assert.deepEqual(probe.calls, [], "a profile that is not installed is never started");
  assert.equal(selection.initialProbeSettled(), true);
  assert.equal(selection.selectedProfile(), undefined);
  assert.deepEqual(selection.candidates("/workspace"), []);
  assert.ok(
    selection.profiles().every(candidate => candidate.availability.state === "not-installed")
  );
  selection.dispose();
});

test("a profile that cannot be launched here reports a connection error", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({
    profiles: [
      { name: "Pi", rank: 0, entry: () => undefined },
      agentProfile("Vibe", 1, INSTALLED)
    ],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");

  assert.deepEqual(probe.calls, ["Vibe"], "an unlaunchable profile is never started");
  assert.equal(view(selection.profiles(), "Pi").availability.state, "connection-error");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  selection.dispose();
});

test("the probed states live for the panel and a refresh probes them again", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });

  await selection.probeInitial("/workspace");
  // Reading the states never re-probes: the cache is the panel's.
  selection.profiles();
  selection.candidates("/workspace");
  selection.selectedProfile();
  assert.deepEqual(probe.calls, ["Copilot"]);

  await selection.refresh("/workspace");
  assert.deepEqual(probe.calls, ["Copilot", "Copilot"], "a refresh probes again");
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");

  // Nothing survives disposal: the panel owns every established state.
  selection.dispose();
  assert.equal(selection.selectedProfile(), undefined);
  assert.ok(selection.profiles().every(candidate => candidate.availability.state === "unknown"));
});

test("probing the unverified profiles verifies them without re-probing the others", async () => {
  const probe = scriptedProbe({
    Codex: { state: "available", configOptions: [] }
  });
  const selection = new AgentSelection({
    profiles: [agentProfile("Copilot", 0, ABSENT), VIBE, CODEX, CLAUDE],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");
  assert.deepEqual(probe.calls, ["Vibe"]);

  await selection.probeUnverified("/workspace");

  assert.deepEqual(probe.calls, ["Vibe", "Codex", "Claude Code"]);
  assert.equal(view(selection.profiles(), "Codex").availability.state, "available");
  // The automatic selection was established before: a later probe never
  // replaces the agent that already answers.
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  selection.dispose();
});

test("signing an agent in re-probes that profile alone and keeps the cached neighbours", async () => {
  const loginMethods = [{ id: "copilot-login", name: "Copilot login" }];
  const calls: string[] = [];
  const selection = new AgentSelection({
    profiles: [agentProfile("Copilot", 0, INSTALLED), VIBE, CODEX],
    probe: async (profile: AgentProfile) => {
      calls.push(profile.name);
      if (profile.name !== "Copilot") {
        return { availability: { state: "available" as const, configOptions: [] } };
      }
      // Copilot waits for authentication until the reader connects it: the
      // second probe of that one profile is what a Sign in observes.
      const first = calls.filter(name => name === "Copilot").length === 1;
      return first
        ? {
            availability: { state: "auth-required" as const, authMethods: loginMethods },
            authMethods: loginMethods
          }
        : { availability: { state: "available" as const, configOptions: [] } };
    }
  });

  await selection.probeInitial("/workspace");
  assert.deepEqual(calls, ["Copilot", "Vibe"], "the initial probe stops at Vibe");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  // The methods the probe announced are kept next to the state.
  assert.deepEqual(selection.authMethods("Copilot"), loginMethods);

  await selection.probeProfile("Copilot", "/workspace");

  // One profile was probed again: the neighbours were never started a second
  // time and keep exactly the state the panel established.
  assert.deepEqual(calls, ["Copilot", "Vibe", "Copilot"]);
  assert.equal(view(selection.profiles(), "Copilot").availability.state, "available");
  assert.equal(view(selection.profiles(), "Vibe").availability.state, "available");
  assert.equal(
    view(selection.profiles(), "Codex").availability.state,
    "unverified",
    "the profile after the first available one was never probed"
  );
  // Connecting an agent replaces neither the profile that answers nor the
  // reader's choice.
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  selection.select("Vibe");
  await selection.probeProfile("Copilot", "/workspace");
  assert.equal(selection.explicitSelection()?.profile.name, "Vibe");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  selection.dispose();
  assert.deepEqual(selection.authMethods("Copilot"), [], "nothing survives the panel");
});

test("a panel with no usable agent gains the profile the reader just connected", async () => {
  const loginMethods = [{ id: "copilot-login", name: "Copilot login" }];
  let probes = 0;
  const selection = new AgentSelection({
    profiles: [agentProfile("Copilot", 0, INSTALLED), agentProfile("Vibe", 1, ABSENT)],
    probe: async () =>
      probes++ === 0
        ? {
            availability: { state: "auth-required" as const, authMethods: loginMethods },
            authMethods: loginMethods
          }
        : { availability: { state: "available" as const, configOptions: [] } }
  });

  await selection.probeInitial("/workspace");
  assert.equal(selection.selectedProfile(), undefined);
  assert.deepEqual(selection.candidates("/workspace"), []);

  await selection.probeProfile("Copilot", "/workspace");

  // The reader's own sign in is what makes the panel usable again, and the
  // profile they connected is the one that answers.
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot"]
  );
  selection.dispose();
});

test("a question asked during the initial probe waits for its settlement", async () => {
  let answerProbe: (outcome: { availability: AgentAvailability }) => void = () => undefined;
  let probed = false;
  const selection = new AgentSelection({
    profiles: CATALOGUE,
    probe: () => {
      probed = true;
      return new Promise(resolve => {
        answerProbe = resolve;
      });
    }
  });

  const running = selection.probeInitial("/workspace");
  assert.equal(probed, true);
  let settled = false;
  const waiting = selection.whenInitialProbeSettled().then(() => {
    settled = true;
  });
  // A question never starts on an unverified profile: nothing answers yet.
  assert.equal(selection.initialProbeSettled(), false);
  assert.deepEqual(selection.candidates("/workspace"), []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);

  answerProbe({ availability: { state: "available", configOptions: [] } });
  await running;
  await waiting;

  assert.equal(settled, true);
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot"]
  );
  selection.dispose();
});

test("only the initial automatic selection may fall through to the next profile", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });

  await selection.probeInitial("/workspace");
  await selection.probeUnverified("/workspace");

  // Before the first answer, another available profile is still a fallback
  // for the initial selection, never the preselection itself.
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot", "Vibe", "Codex", "Claude Code"]
  );
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");

  selection.hasConversationStarted();
  // Once an answer settled, the same agent is retried alone: nothing falls
  // through any more.
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot"]
  );
  selection.dispose();
});

test("an unavailable profile is never a candidate even before the first answer", async () => {
  const probe = scriptedProbe({
    Vibe: { state: "auth-required", authMethods: [] },
    Codex: {
      state: "connection-error",
      reason: "The agent did not answer the probe within 5 s."
    }
  });
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });

  await selection.probeInitial("/workspace");
  await selection.probeUnverified("/workspace");

  // Only the available profiles may answer, in rank order: the profile that
  // needs authentication and the one that timed out never do, even as a
  // fallback before the first question.
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot", "Claude Code"]
  );
  selection.dispose();
});

test("a question waits for the probe, never starts unverified, and a failure never re-probes", async () => {
  // The panel's responder, exactly as `openStepChatAgents` builds it: the
  // candidates are the Agent Selection's, so the catalogue alone decides who
  // answers.
  const probe = scriptedProbe({});
  const selection = new AgentSelection({
    profiles: [
      { name: "Copilot", rank: 0, entry: cwd => ({
        command: process.execPath,
        args: [path.join(os.tmpdir(), "codetour-absent-agent.js")],
        cwd
      }) },
      VIBE
    ],
    probe: probe.probe
  });
  const responder = createFallbackStepChatResponder(
    cwd => selection.candidates(cwd),
    {
      whenReady: () => selection.whenInitialProbeSettled(),
      onConversationStarted: () => selection.hasConversationStarted()
    }
  );
  const question = {
    question: "Who answers?",
    context: { available: false as const, description: "A tour step" },
    history: [],
    workspaceRoot: "/workspace"
  };
  try {
    // The probe reports Copilot available, but the conversation wait it: the
    // question asked during the probe cannot reach a profile before it.
    const answer = Promise.resolve(responder.answer(question));
    assert.equal(probe.calls.length, 0, "no profile was answered before the probe");
    await selection.probeInitial("/workspace");
    // The probed Copilot cannot actually open a session, and Vibe was never
    // verified: the question fails instead of falling through to it.
    await assert.rejects(answer, StepChatAgentUnavailableError);
    assert.deepEqual(probe.calls, ["Copilot"], "a conversation failure probes nothing");
    assert.equal(selection.selectedProfile()?.profile.name, "Copilot");

    // The first answer settled: the same profile is retried alone, and the
    // catalogue is never probed again by the conversation.
    assert.deepEqual(
      selection.candidates("/workspace").map(candidate => candidate.name),
      ["Copilot"]
    );
    assert.deepEqual(probe.calls, ["Copilot"]);
  } finally {
    await responder.dispose?.();
    selection.dispose();
  }
});

test("a profile cannot be chosen by hand when it is not installed", async () => {
  const probe = scriptedProbe({});
  const selection = new AgentSelection({
    profiles: [COPILOT, agentProfile("Vibe", 1, ABSENT)],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");

  // The catalogue still lists it, with its state, but the reader cannot pick
  // an agent that is not on the machine.
  selection.select("Vibe");
  assert.equal(selection.hasExplicitSelection(), false);
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  assert.equal(
    isSelectable(view(selection.profiles(), "Vibe").availability),
    false
  );
  // A name outside the catalogue is ignored as well.
  selection.select("Not an agent");
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  selection.dispose();
});

test("an unauthenticated or unreachable profile stays selectable by hand", async () => {
  const probe = scriptedProbe({
    Copilot: {
      state: "auth-required",
      authMethods: [{ id: "copilot-login", name: "Copilot login" }]
    },
    Vibe: {
      state: "connection-error",
      reason: "The agent did not answer the probe within 5 s."
    }
  });
  const selection = new AgentSelection({
    profiles: [COPILOT, VIBE],
    probe: probe.probe
  });

  await selection.probeInitial("/workspace");
  // Nothing answered automatically: neither state qualifies.
  assert.equal(selection.selectedProfile(), undefined);

  // A slow start does not condemn an agent: the reader may still ask it.
  selection.select("Vibe");
  assert.equal(selection.explicitSelection()?.profile.name, "Vibe");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Vibe"]
  );

  // A profile waiting for authentication is selectable too.
  selection.select("Copilot");
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Copilot"]
  );
  selection.dispose();
});

test("an explicit choice is never replaced and its candidates shrink to it", async () => {
  const outcomes: Record<string, AgentAvailability> = {
    Vibe: {
      state: "connection-error",
      reason: "The agent did not answer the probe within 5 s."
    }
  };
  const calls: string[] = [];
  const selection = new AgentSelection({
    profiles: CATALOGUE,
    probe: async (profile: AgentProfile) => {
      calls.push(profile.name);
      return {
        availability: outcomes[profile.name] ?? {
          state: "available" as const,
          configOptions: []
        }
      };
    }
  });

  await selection.probeInitial("/workspace");
  assert.equal(selection.selectedProfile()?.profile.name, "Copilot");

  selection.select("Vibe");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  // An explicit choice answers alone: no other profile may fall through.
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Vibe"]
  );

  // A refresh probes the whole catalogue (nothing automatic is left to
  // decide) and finds another profile available: the choice stands.
  calls.length = 0;
  await selection.refresh("/workspace");
  assert.deepEqual(calls, ["Copilot", "Vibe", "Codex", "Claude Code"]);
  assert.equal(view(selection.profiles(), "Copilot").availability.state, "available");
  assert.equal(selection.explicitSelection()?.profile.name, "Vibe");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Vibe"]
  );

  // Probing the unverified profiles and a settled conversation change
  // nothing either: only the reader replaces the reader's choice.
  selection.hasConversationStarted();
  await selection.probeUnverified("/workspace");
  assert.equal(selection.selectedProfile()?.profile.name, "Vibe");
  assert.deepEqual(
    selection.candidates("/workspace").map(candidate => candidate.name),
    ["Vibe"]
  );

  // Nothing survives the panel.
  selection.dispose();
  assert.equal(selection.hasExplicitSelection(), false);
  assert.equal(selection.selectedProfile(), undefined);
});

/** A model selector as an agent announces it: grouped values, labelled ids. */
function modelOption(currentValue: string, values: string[]) {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select" as const,
    currentValue,
    options: [
      {
        group: "standard",
        name: "Standard",
        options: values.map(value => ({ value, name: value.toUpperCase() }))
      }
    ]
  };
}

/**
 * A probe announcing each profile's model values, and nothing else: what an
 * agent that really offers a choice answers.
 */
function modelProbe(offers: Record<string, string[]>) {
  const calls: string[] = [];
  return {
    calls,
    probe: async (profile: AgentProfile): Promise<{
      availability: AgentAvailability;
    }> => {
      calls.push(profile.name);
      const values = offers[profile.name] ?? [];
      return {
        availability: {
          state: "available",
          configOptions: values.length ? [modelOption(values[0], values)] : []
        }
      };
    }
  };
}

test("the reader's model choice is remembered per Agent Profile, apart from the agent selection", async () => {
  const probe = modelProbe({ Copilot: ["fast", "smart"], Vibe: ["vibe-fast", "vibe-smart"] });
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });
  await selection.probeInitial("/workspace");

  // The selector lists only what the probed availability announces, groups
  // flattened.
  assert.deepEqual(selection.modelOptions("Copilot"), [
    { value: "fast", name: "FAST" },
    { value: "smart", name: "SMART" }
  ]);
  // An agent that announces no model has nothing to offer.
  assert.deepEqual(selection.modelOptions("Codex"), []);
  assert.equal(selection.selectedModel(), undefined);
  // Before the reader chooses, the probe's announcement is the only model the
  // panel can honestly name.
  assert.equal(selection.announcedModel("Copilot"), "fast");
  assert.equal(selection.announcedModel("Codex"), undefined);

  // Each profile keeps its own choice: model identifiers belong to one agent.
  selection.chooseModel("Copilot", "smart");
  selection.chooseModel("Vibe", "vibe-smart");
  assert.equal(selection.modelFor("Copilot"), "smart");
  assert.equal(selection.selectedModel(), "smart");

  // Moving the conversation to another agent does not touch either choice.
  selection.select("Vibe");
  assert.equal(selection.selectedModel(), "vibe-smart");
  assert.equal(selection.modelFor("Copilot"), "smart");
  selection.select("Copilot");
  assert.equal(selection.selectedModel(), "smart");
  assert.equal(selection.modelFor("Vibe"), "vibe-smart");

  // Choosing nothing forgets the choice: the agent decides alone again.
  selection.chooseModel("Copilot", undefined);
  assert.equal(selection.modelFor("Copilot"), undefined);
});

test("a model choice the profile stops announcing is dropped on a refresh", async () => {
  const offers: Record<string, string[]> = { Copilot: ["fast", "smart"] };
  const probe = modelProbe(offers);
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });
  await selection.probeInitial("/workspace");

  selection.chooseModel("Copilot", "smart");
  assert.equal(selection.modelFor("Copilot"), "smart");

  // The profile still announces the choice: a refresh keeps it.
  await selection.refresh("/workspace");
  assert.equal(selection.modelFor("Copilot"), "smart");

  // The profile stops announcing it: the display must never show a model the
  // agent does not have.
  offers.Copilot = ["fast"];
  await selection.refresh("/workspace");
  assert.equal(selection.modelFor("Copilot"), undefined);
  selection.dispose();
});

test("a session that no longer announces the choice drops it, and one that still does keeps it", async () => {
  const probe = modelProbe({ Copilot: ["fast", "smart"] });
  const selection = new AgentSelection({ profiles: CATALOGUE, probe: probe.probe });
  await selection.probeInitial("/workspace");
  const offered = selection.modelOptions("Copilot");

  selection.chooseModel("Copilot", "smart");
  // The agent switched to another value by itself but still announces the
  // reader's choice: it is replayed at the next session.
  selection.recordEffective("Copilot", "fast", offered);
  assert.equal(selection.modelFor("Copilot"), "smart");

  // The session confirms the choice itself: it stays remembered.
  selection.recordEffective("Copilot", "smart", offered);
  assert.equal(selection.modelFor("Copilot"), "smart");

  // A session that no longer lists the choice drops it: the reader sees the
  // agent's own value instead of a stale request.
  selection.recordEffective("Copilot", "fast", [
    { value: "fast", name: "FAST" }
  ]);
  assert.equal(selection.modelFor("Copilot"), undefined);

  // Nothing model-related survives the panel either.
  selection.chooseModel("Copilot", "smart");
  selection.dispose();
  assert.equal(selection.modelFor("Copilot"), undefined);
  assert.deepEqual(selection.modelOptions("Copilot"), []);
});
