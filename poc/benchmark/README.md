# PostgreSQL benchmark — spec #174

Authority: [GitHub #174](https://github.com/maurice30120/codetour/issues/174), including its complement and [#172](https://github.com/maurice30120/codetour/issues/172). Local historical ticket checklists are not proof that a gate passed.

The previous 80 traces and their claimed pre-registration are preserved in `results_invalidated_fabricated_2026-11-15/`. They are simulated and must never be used as principal measurements. The replacement manifest is a **draft**, not a frozen experiment.

## Local checks

Install each package's declared dependencies before running these commands. Use the Node version declared by the repository.

```sh
npm --prefix packages/exploration-poc test
npm --prefix packages/exploration-sandbox test
npm --prefix packages/vibe-connector run build
npm --prefix packages/vibe-connector test
npm --prefix poc/benchmark/evaluator run build
npm --prefix poc/benchmark/evaluator test -- --runInBand
npm --prefix poc/benchmark/runner run build
npm --prefix poc/benchmark/runner test
npm --prefix poc/benchmark run typecheck
npm --prefix poc/benchmark test
```

Collect actual G0/G4 test transcripts, bound to the current sources:

```sh
node poc/benchmark/verify-tests.mjs
```

Inspect prerequisites without invoking a provider, altering a manifest lock, or starting the campaign:

```sh
node poc/benchmark/preflight.mjs --fixture /absolute/path/to/postgres --output /tmp/spec174-preflight.json
```

Exit status `2` means **NO-GO**. Missing, failed or stale evidence closes the corresponding gate. Positive totals and a `passed` flag alone do not prove native invocation or complete telemetry.

## Actual campaign

Configure the CodeTour provider through `MISTRAL_API_KEY` and `MISTRAL_MODEL`, and the Vibe model through `VIBE_MODEL`. Vibe must also be authenticated using its own supported mechanism. Credentials are never written into the manifest or reports. Set `CODETOUR_FIXTURE_PATH` to the read-only PostgreSQL checkout at the specified SHA.

Run the connector sentinel against that checkout and preserve its raw root/child evidence. Independently review the sealed questions, evaluation rubric, model differences, budgets, and dependency-aware statistical method. Resolve every draft field and bind the exact questions, references, prompts and implementation before G5. Never copy old validation flags into a new registration.

The pilot uses `pilot-questions.json`, outside the measured set, and separate storage under `results/pilot`. A failed pilot cannot freeze the experiment or start the main campaign. After a successful pilot, the runner freezes the measured configuration. Main execution verifies G0–G5 and the fixture, preserves all failures and their usage, alternates agents and resets procedural memory only between series.

```sh
npm --prefix poc/benchmark run campaign
```

Completion of 80 executions means **awaiting blind evaluation**, not validation of the savings hypothesis. Use the independent evaluation and reporting workflows to obtain the final verdict. Evaluator tokens remain separate. Unknown usage forbids a global reduction; reuse counts never become claimed per-function savings.
