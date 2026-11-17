import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explore } from './fixture-explore.ts';
import { scriptMemory } from '../src/memory.ts';
import { DECOMPOSITION_PROMPT } from '../src/decomposition-prompt.ts';

/**
 * Issue #188 (D05) — the end-to-end feasibility diagnostic of spec #183.
 *
 * Tour A starts with an empty catalogue, publishes a revisable plan, tries a
 * reusable TypeScript procedure, repairs it after a deterministic citation
 * failure, and gets it accepted by consolidation. Tour B is an independent
 * run on the same repository and the same persistent catalogue: it finds the
 * acquired capability with memory_list and reuses it with memory_run without
 * recreating the code. Deterministic Model stubs make the whole chain
 * reproducible; every scenario observes behaviour and artefacts at the
 * explore() seam. This diagnostic is not the #174 Vibe benchmark and makes no
 * token-savings claim.
 */

const MAIN_TS = 'export function start(): number {\n  return 1;\n}\n';

/** Reconciliation log entry observed at the explore() seam. */
interface ReconciliationEntry { name: string; proposed: boolean; replayed: boolean; accepted: boolean; reason?: string }
interface ConsolidationReportView { accepted: string[]; rejected: Array<{ name: string; reason: string }>; reconciliation: ReconciliationEntry[] }

const FRENCH_ACCENTS = /[éèêëàâçôûîüöÉÈÊËÀÂÇÔÛÎÜÖœŒ]/;

/** The harness instructions around the #184-owned decomposition prompt stay English (ADR 0015). */
function assertEnglishInstructions(systemPrompt: string): void {
  assert.ok(systemPrompt.includes(DECOMPOSITION_PROMPT), 'the system prompt must embed the canonical decomposition prompt');
  const harnessInstructions = systemPrompt.replace(DECOMPOSITION_PROMPT, '');
  assert.ok(!FRENCH_ACCENTS.test(harnessInstructions), 'the harness instructions must stay English even for a French request');
}

// The candidate procedure: every searchText hit with its exact source context.
// The broken first trial claims a five-line context window that runs past the
// end of the three-line fixture file — the #185 validator refuses it.
const BROKEN_SOURCE = '((input: { query: string }) => searchText(input.query).map(hit => ({ file: hit.file, startLine: hit.line, endLine: hit.line + 5, text: hit.text })))';
const REPAIRED_SOURCE = '((input: { query: string }) => searchText(input.query).map(hit => ({ ...hit, startLine: hit.line, endLine: hit.line })))';
const CANDIDATE_NAME = 'traceRepoEntryContext';
const CANDIDATE_QUESTION = 'Where are the declared entry points and their exact source context?';
const CANDIDATE_DESCRIPTION = 'Searches the repository for entry point declarations and returns each match with its exact single-line source context. Results respect the searchText primitive bounds.';

async function fixtureRepo(prefix: string): Promise<{ base: string; root: string; memory: { directory: string } }> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const root = join(base, 'repo');
  await mkdir(root);
  await writeFile(join(root, 'main.ts'), MAIN_TS);
  return { base, root, memory: { directory: join(base, 'memory') } };
}

test('Tour A creates, repairs and consolidates a procedure, then Tour B reuses it through memory_list and memory_run', async t => {
  const { base, root, memory } = await fixtureRepo('d05-two-tours-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const frenchObjective = 'Explique le point d’entrée principal du dépôt et son contexte source';
  const generousBudget = { iterations: 12, calls: 48, tokens: 60000, durationMs: 60000 };
  const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens });

  // ---- Tour A: empty catalogue, plan, broken trial, repair, validated proposal ----
  let step = 0;
  const tourA = await explore({ root, objective: frenchObjective, codeMode: true, memory, budget: generousBudget, model: {
    async complete(messages) {
      const current = step++;
      if (current === 0) {
        assertEnglishInstructions(messages[0].content);
        assert.equal(messages[1].content, frenchObjective);
        return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: usage(150, 40), toolCalls: [{ id: 'try-1', name: 'function_try', arguments: { question_id: 'q1', source: BROKEN_SOURCE, params: { query: 'start' }, remember: true, name: CANDIDATE_NAME, question: CANDIDATE_QUESTION, description: CANDIDATE_DESCRIPTION } }] };
      }
      if (current === 1) {
        // The citation-invalid trial returns short structured repair feedback,
        // never its raw result: the faulty reference alone is identified.
        const feedback = JSON.parse(messages.at(-1).content);
        assert.equal(feedback.error, 'invalid_citation: 1 of 1 references invalid');
        assert.equal(feedback.validation.status, 'validation_failed');
        assert.equal(feedback.validation.invalidReferences[0].file, 'main.ts');
        assert.match(feedback.validation.invalidReferences[0].errors.join(' '), /beyond the end of the file/);
        // The plan is revised with an explicit reason, as a new appended version.
        return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }, { id: 'q2', question: 'What does the start entry point return?', reuse: false }], reason: 'Added a return-value question after the first trial exposed an over-broad context range.' }, usage: usage(180, 55), toolCalls: [{ id: 'try-2', name: 'function_try', arguments: { question_id: 'q1', source: REPAIRED_SOURCE, params: { query: 'start' }, remember: true, name: CANDIDATE_NAME, question: CANDIDATE_QUESTION, description: CANDIDATE_DESCRIPTION } }] };
      }
      if (current === 2) {
        // The corrected trial is validated: its bounded result reaches the model.
        const repaired = JSON.parse(messages.at(-1).content);
        assert.equal(repaired.result[0].file, 'main.ts');
        assert.equal(repaired.result[0].startLine, 1);
        assert.equal(repaired.result[0].endLine, 1);
        return { usage: usage(200, 60), result: { objective: frenchObjective, entryPoints: [{ name: 'point d’entrée principal', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: ['Aucune incertitude relevée.'] } };
      }
      // Consolidation selection: the model proposes the executed candidate.
      assert.match(messages[0].content, /select.*executed/i);
      return { usage: usage(90, 12), result: { selected: [CANDIDATE_NAME] } };
    }
  } });

  // Correlation backbone: run_id links plan versions, calls and consolidation.
  assert.ok(tourA.runId, 'the run carries a run_id');
  assert.equal(tourA.status, 'complete');
  assert.equal(tourA.stopReason, null);
  assert.equal(tourA.plan.status, 'recorded');
  assert.equal(tourA.plan.runId, tourA.runId);
  assert.deepEqual(tourA.plan.initial, { understand: ['Understand the question'], investigate: ['Inspect relevant code'], reuse: [] });
  assert.equal(tourA.objective, frenchObjective);
  assert.equal(tourA.entryPoints[0].name, 'point d’entrée principal');
  const planTrace = tourA.callTrace.filter(call => call.type === 'decomposition_plan');
  assert.equal(planTrace.length, 1);
  assert.ok(planTrace.every(call => call.runId === tourA.runId));

  // The repair loop is traceable: try-1 fails citation validation, try-2 passes.
  const trials = tourA.callTrace.filter(call => call.type === 'function_try' && call.name === 'function_try');
  assert.equal(trials.length, 2);
  assert.deepEqual(trials.map(call => call.callId), ['try-1', 'try-2']);
  assert.ok(trials.every(call => call.questionId === 'q1' && call.runId === tourA.runId));
  assert.match(trials[0].outcome ?? '', /citations=validation_failed \(0\/1 valid\)/);
  assert.equal(trials[1].outcome, 'returned=1; citations=1 valid');

  // Deterministic reconciliation: exact replay, citation re-check, acceptance.
  const reportA = tourA.consolidationReport as ConsolidationReportView;
  assert.deepEqual(reportA.accepted, [CANDIDATE_NAME]);
  assert.equal(reportA.rejected.length, 0);
  assert.equal(reportA.reconciliation.length, 1);
  assert.deepEqual(reportA.reconciliation[0], { name: CANDIDATE_NAME, proposed: true, replayed: true, accepted: true });
  assert.ok(tourA.callTrace.some(call => call.name === 'consolidation-validation' && /citations=1 valid/.test(String(call.outcome))));

  // Real token accounting from the Model seam: no simulated counters.
  assert.equal(tourA.metrics.usageAvailable, true);
  assert.equal(tourA.metrics.inputTokens, 150 + 180 + 200 + 90);
  assert.equal(tourA.metrics.outputTokens, 40 + 55 + 60 + 12);
  const modelCalls = tourA.callTrace.filter(call => call.type === 'model');
  assert.equal(modelCalls.length, 4);
  assert.ok(modelCalls.every(call => call.inputTokens !== null && call.outputTokens !== null && !call.usageMissing));

  // The procedure is persisted in the shared catalogue, without source code exposure.
  const persisted = (await scriptMemory(root, memory.directory)).memory_list('entry point')[0];
  assert.equal(persisted.id, CANDIDATE_NAME);
  assert.equal(persisted.objective, CANDIDATE_QUESTION);
  assert.equal('code' in persisted, false);

  // ---- Tour B: independent run, same repository, same persistent catalogue ----
  const frenchObjectiveB = 'Montre le contexte source du point d’entrée principal';
  let reuseStep = 0;
  const tourB = await explore({ root, objective: frenchObjectiveB, codeMode: true, memory, budget: generousBudget, model: {
    async complete(messages) {
      const current = reuseStep++;
      if (current === 0) {
        assertEnglishInstructions(messages[0].content);
        // The catalogue briefing lists the acquired capability.
        assert.match(messages[0].content, new RegExp(CANDIDATE_NAME));
        return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: usage(160, 35), toolCalls: [{ id: 'list-1', name: 'memory_list', arguments: { question_id: 'q1', query: 'entry point' } }] };
      }
      if (current === 1) {
        // memory_list exposes the capability without its source code.
        const listed = JSON.parse(messages.at(-1).content);
        assert.equal(listed[0].id, CANDIDATE_NAME);
        assert.equal('code' in listed[0], false);
        return { usage: usage(140, 30), toolCalls: [{ id: 'run-1', name: 'memory_run', arguments: { question_id: 'q1', id: CANDIDATE_NAME, params: { query: 'start' } } }] };
      }
      // The reused capability returns the proven context; no code is recreated.
      const reused = JSON.parse(messages.at(-1).content);
      assert.equal(reused.result[0].file, 'main.ts');
      assert.equal(reused.result[0].startLine, 1);
      assert.equal(reused.result[0].endLine, 1);
      return { usage: usage(170, 50), result: { objective: frenchObjectiveB, entryPoints: [{ name: 'contexte source du point d’entrée principal', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    }
  } });

  // Independent run ids link each Tour's own trace entries.
  assert.ok(tourB.runId && tourB.runId !== tourA.runId);
  assert.equal(tourB.status, 'complete');
  assert.equal(tourB.objective, frenchObjectiveB);

  // Observable memory_list then memory_run, both correlated to the plan question.
  const listCall = tourB.callTrace.find(call => call.type === 'memory_list');
  const runCall = tourB.callTrace.find(call => call.type === 'memory_run');
  assert.ok(listCall && runCall, 'Tour B must consult the catalogue then run the memorized procedure');
  assert.equal(listCall.callId, 'list-1');
  assert.equal(runCall.callId, 'run-1');
  assert.ok(listCall.questionId === 'q1' && runCall.questionId === 'q1');
  assert.ok(listCall.runId === tourB.runId && runCall.runId === tourB.runId);
  assert.ok(listCall.seq < runCall.seq, 'memory_list precedes memory_run');
  // Traceable proof: the reuse carries the sandbox execution trace.
  assert.ok(runCall.execution, 'the memory_run trace keeps the execution proof');
  assert.deepEqual(runCall.parameters, { id: CANDIDATE_NAME, params: { query: 'start' } });
  assert.match(JSON.stringify(runCall.result), /main\.ts/);
  assert.equal(tourB.metrics.memoryReuses, 1);
  assert.equal(runCall.memory?.id, CANDIDATE_NAME, 'each memory_run trace carries its own reuse outcome');
  assert.equal(runCall.memory?.stale, false);
  // No code was recreated during the reuse Tour.
  assert.equal(tourB.callTrace.filter(call => call.type === 'function_try').length, 0);
  const reportB = tourB.consolidationReport as ConsolidationReportView;
  assert.deepEqual(reportB.accepted, []);
  assert.deepEqual(reportB.reconciliation, []);
  // The catalogue is unchanged by the reuse: still exactly the acquired capability.
  const catalogAfter = await scriptMemory(root, memory.directory);
  assert.equal(catalogAfter.catalog().length, 1);
  assert.equal(tourB.metrics.inputTokens, 160 + 140 + 170);
});

test('the diagnostic records the initial plan', async t => {
  const { base, root, memory } = await fixtureRepo('d05-no-plan-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
    async complete(messages) {
      if (messages.length === 2) return { usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ id: 'search', name: 'searchText', arguments: { query: 'start' } }] };
      return { usage: { inputTokens: 60, outputTokens: 15 }, result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    }
  } });
  assert.equal(result.plan.status, 'recorded');
  assert.equal(result.plan.runId, result.runId);
  assert.equal(result.status, 'complete');
});

test('the diagnostic distinguishes a Tour where no candidate was considered', async t => {
  const { base, root, memory } = await fixtureRepo('d05-no-candidate-');
  t.after(() => rm(base, { recursive: true, force: true }));
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
    async complete() {
      if (step++ === 0) return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ id: 'search', name: 'searchText', arguments: { question_id: 'q1', query: 'start' } }] };
      return { usage: { inputTokens: 60, outputTokens: 15 }, result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    }
  } });
  // The Tour validates and completes, but no procedure was ever proposed: the
  // reconciliation log is explicitly empty, not silently absent.
  const report = result.consolidationReport as ConsolidationReportView;
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.reconciliation, []);
  assert.equal(result.status, 'complete');
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('the diagnostic distinguishes a candidate proposed but never tried', async t => {
  const { base, root, memory } = await fixtureRepo('d05-proposed-untried-');
  t.after(() => rm(base, { recursive: true, force: true }));
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
    async complete() {
      if (step++ === 0) return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ id: 'try-1', name: 'function_try', arguments: { question_id: 'q1', source: '((input: { query: string }) => undeclaredHelper(input.query))', params: { query: 'start' }, remember: true, name: CANDIDATE_NAME, question: CANDIDATE_QUESTION, description: CANDIDATE_DESCRIPTION } }] };
      return { usage: { inputTokens: 60, outputTokens: 15 }, result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    }
  } });
  // The trial never executed (TypeScript error): the proposal is an explicit
  // reconciliation outcome — proposed but not tried — never a silent gap.
  const failedTry = result.callTrace.find(call => call.type === 'function_try');
  assert.ok(failedTry);
  assert.match(failedTry.error ?? '', /TS2304/);
  const report = result.consolidationReport as ConsolidationReportView;
  assert.deepEqual(report.accepted, []);
  assert.equal(report.reconciliation.length, 1);
  assert.equal(report.reconciliation[0].name, CANDIDATE_NAME);
  assert.equal(report.reconciliation[0].proposed, true);
  assert.equal(report.reconciliation[0].replayed, false);
  assert.equal(report.reconciliation[0].accepted, false);
  assert.match(report.reconciliation[0].reason ?? '', /trial failed before execution/i);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('the diagnostic distinguishes a validation failure from an untried proposal', async t => {
  const { base, root, memory } = await fixtureRepo('d05-validation-failed-');
  t.after(() => rm(base, { recursive: true, force: true }));
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
    async complete() {
      if (step++ === 0) return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ id: 'try-1', name: 'function_try', arguments: { question_id: 'q1', source: BROKEN_SOURCE, params: { query: 'start' }, remember: true, name: CANDIDATE_NAME, question: CANDIDATE_QUESTION, description: CANDIDATE_DESCRIPTION } }] };
      return { usage: { inputTokens: 60, outputTokens: 15 }, result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } };
    }
  } });
  // The trial executed but its citations failed validation: the failure lives
  // in the function_try trace outcome, and no candidate reaches the
  // reconciliation log — a different, unambiguous signature from an untried
  // proposal.
  const trial = result.callTrace.find(call => call.type === 'function_try');
  assert.ok(trial);
  assert.match(trial.outcome ?? '', /citations=validation_failed/);
  const report = result.consolidationReport as ConsolidationReportView;
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.reconciliation, []);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('the diagnostic distinguishes an unvalidated Tour', async t => {
  const { base, root, memory } = await fixtureRepo('d05-unvalidated-tour-');
  t.after(() => rm(base, { recursive: true, force: true }));
  let step = 0;
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
    async complete() {
      step++;
      return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 50, outputTokens: 10 }, result: { objective: 'Explain start', entryPoints: [], components: [], relations: [], uncertainties: [] } };
    }
  } });
  assert.equal(step, 2, 'one in-budget evidence recovery, then an honest stop');
  assert.equal(result.status, 'partial');
  assert.equal(result.stopReason, 'evidence_missing');
  // A partial Tour never consolidates: the reconciliation log stays empty.
  const report = result.consolidationReport as ConsolidationReportView;
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.reconciliation, []);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0);
});

test('the diagnostic distinguishes reconciliation not reached from a final refusal', async t => {
  const { base, root, memory } = await fixtureRepo('d05-refusal-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const runTour = async (description: string, selected: string[]) => {
    let step = 0;
    const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, model: {
      async complete(messages) {
        if (step === 0) { step++; return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ id: 'try-1', name: 'function_try', arguments: { question_id: 'q1', source: REPAIRED_SOURCE, params: { query: 'start' }, remember: true, name: CANDIDATE_NAME, question: CANDIDATE_QUESTION, description } }] }; }
        if (step === 1) { step++; return { usage: { inputTokens: 60, outputTokens: 15 }, result: { objective: 'Explain start', entryPoints: [{ name: 'start', evidence: [{ file: 'main.ts', startLine: 1, endLine: 1 }] }], components: [], relations: [], uncertainties: [] } }; }
        step++;
        assert.match(messages[0].content, /select.*executed/i);
        return { usage: { inputTokens: 90, outputTokens: 12 }, result: { selected } };
      }
    } });
    return result.consolidationReport as ConsolidationReportView;
  };

  // Reconciliation not reached: the model selects nothing, so the deterministic
  // replay never runs for the auto-submitted candidate (issue #194).
  const notProposed = await runTour(CANDIDATE_DESCRIPTION, []);
  assert.deepEqual(notProposed.accepted, []);
  assert.equal(notProposed.reconciliation.length, 1);
  assert.deepEqual(notProposed.reconciliation[0], { name: CANDIDATE_NAME, proposed: false, replayed: false, accepted: false, reason: 'Not selected by the model for consolidation' });

  // Final refusal: the candidate is proposed and replayed, but the deterministic
  // description gate refuses it — a precise reason, no persistence.
  const refused = await runTour('Trouve les points d’entrée du dépôt avec leur contexte.', [CANDIDATE_NAME]);
  assert.deepEqual(refused.accepted, []);
  assert.equal(refused.reconciliation.length, 1);
  assert.equal(refused.reconciliation[0].proposed, true);
  assert.equal(refused.reconciliation[0].replayed, true);
  assert.equal(refused.reconciliation[0].accepted, false);
  assert.match(refused.rejected[0].reason, /description refused/i);
  assert.equal((await scriptMemory(root, memory.directory)).catalog().length, 0, 'no refused candidate ever persists');
});

test('a finite budget stops the run with an explicit stop reason and observable token counts', async t => {
  const { base, root, memory } = await fixtureRepo('d05-budget-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const result = await explore({ root, objective: 'Explain start', codeMode: true, memory, budget: { iterations: 3, calls: 20, tokens: 100000, durationMs: 60000 }, model: {
    async complete() {
      return { plan: { questions: [{ id: 'q1', question: CANDIDATE_QUESTION, reuse: true }] }, usage: { inputTokens: 100, outputTokens: 20 }, toolCalls: [{ id: 'search', name: 'searchText', arguments: { question_id: 'q1', query: 'start' } }] };
    }
  } });
  assert.equal(result.stopReason, 'iterations');
  assert.equal(result.status, 'partial');
  // Every LLM call consumed a real, observable amount of tokens from the Model seam.
  const modelCalls = result.callTrace.filter(call => call.type === 'model');
  assert.equal(modelCalls.length, 2);
  assert.ok(modelCalls.every(call => call.inputTokens === 100 && call.outputTokens === 20 && !call.usageMissing));
  assert.equal(result.metrics.inputTokens, 200);
  assert.equal(result.metrics.outputTokens, 40);
});
