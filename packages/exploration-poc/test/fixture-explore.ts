import { explore as runExploration } from '../src/explore.ts';

/** Supply the dedicated planning response for scripted exploration fixtures. */
export function explore(options: Parameters<typeof runExploration>[0]) {
  const model = options.model;
  let planning = true;
  return runExploration({ ...options, model: {
    ...model,
    async complete(messages, settings) {
      if (planning) {
        planning = false;
        return { result: { understand: ['Understand the question'], investigate: ['Inspect relevant code'], reuse: [] }, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      return model.complete(messages, settings);
    }
  } });
}
