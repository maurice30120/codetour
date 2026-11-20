import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mistral } from '../src/mistral.ts';

// Ticket #192 (spec #183, case #167): a final answer of the form
// "\n```json\n{...}" — whitespace before the closing fence — killed the run
// because the fence strip in the connector anchors on an exact string start
// (`^```json`) and does not tolerate preceding whitespace, while the plan
// block removal often leaves a residual newline. The JSON was complete and
// valid. The strip must tolerate benign whitespace variants without weakening
// the typed `FinalAnswerNotJson` error or the single in-run recovery.

test('a final answer with whitespace before the ```json fence parses as valid JSON (#167)', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '\n```json\n{"objective":"ok"}\n```' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    const response = await mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true });
    // The connector returns the parsed payload under its `result` key.
    assert.deepEqual(response.result, { objective: 'ok' });
    assert.deepEqual(JSON.parse(JSON.stringify(response.result)), { objective: 'ok' });
  } finally {
    globalThis.fetch = original;
  }
});

test('a non-JSON final answer carries the block shapes and the provider stop reason', async () => {
  const original = globalThis.fetch;
  try {
    // Diagnostic telemetry for the GLM failure mode: block content formats the
    // text join cannot read (no `text` field, e.g. reasoning blocks) and a
    // finish_reason marking a generation limit. The error must expose both so
    // the failure is diagnosable without capturing the raw payload.
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'thinking', thinking: 'internal reasoning' }, { type: 'other' }] }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    await assert.rejects(
      () => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'FinalAnswerNotJson');
        assert.deepEqual((error as { contentShape?: unknown[] }).contentShape, ['type=thinking;keys=type|thinking', 'type=other;keys=type']);
        assert.equal((error as { finishReason?: string }).finishReason, 'length');
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a truncated or non-JSON final answer still throws the typed error with a content snippet', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '```plan\n{"questions":[]}\n```\nI explored the repository by hand and found' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }));
    await assert.rejects(
      () => mistral('fixture').complete([], { signal: new AbortController().signal, maxOutputTokens: 100, codeMode: true, memory: true }),
      (error: unknown) => {
        assert.equal((error as { name?: string }).name, 'FinalAnswerNotJson');
        assert.match((error as Error).message, /Final answer is not valid JSON/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});
