# Scaled Benchmark for Spec #172

This directory contains the scaled benchmark infrastructure for Spec #172, which executes 20 runs per solution (POC and Vibe) with two independent series: repetition and transfer.

## Overview

The scaled benchmark compares:
- **POC**: CodeTour with memory primitives and script-based exploration
- **Vibe**: Native Vibe research sub-agent

### Series Types

1. **Repetition Series** (10 runs):
   - Same questions repeated across runs
   - For POC: Memory is preserved within the series
   - For Vibe: Sessions are isolated between runs

2. **Transfer Series** (10 runs):
   - New but related questions
   - Tests generalization capability
   - For POC: Memory is reset for each run in this series
   - For Vibe: Sessions are isolated between runs

## Tasks

### Repetition Tasks (from tasks.json)
- `function`: Comment totalPrice calcule-t-elle son résultat ?
- `class`: Quelles dépendances la classe Catalog utilise-t-elle et où ?
- `flow`: Quel est le flux de postOrder jusqu'au calcul du total ?

### Transfer Tasks
- `dependencies`: Quelles sont toutes les dépendances entre les modules de ce répertoire ?
- `error-handling`: Comment ce code gère-t-il les erreurs de recherche dans le catalogue ?
- `data-flow`: Quel est le flux de données de la requête postOrder jusqu'à la réponse finale ?

## Metrics Tracked

For each run, the following metrics are captured:

### Token Metrics
- `inputTokens`: Input tokens consumed
- `outputTokens`: Output tokens generated
- `cacheTokens`: Cache tokens (if available)
- `totalTokens`: Total tokens

### Call Metrics
- `modelCalls`: Number of model calls
- `toolCalls`: Number of tool calls
- `totalCalls`: Total calls (model + tool)

### Performance Metrics
- `durationMs`: Duration in milliseconds
- `cost`: Cost in USD
- `outputBytes`: Output size in bytes

### Function Metrics (POC only)
- `functionsCreated`: Number of functions created
- `functionsReused`: Number of functions reused
- `functionsReplaced`: Number of functions replaced

### Memory Metrics (POC only)
- `memoryReuses`: Number of memory reuses
- `memoryPurges`: Number of memory purges

### Status Metrics
- `status`: Run status (ok, partial, timeout, error, etc.)
- `explorationStatus`: Exploration status
- `stopReason`: Reason for stopping
- `correctness`: Correctness assessment (manual review required)

## Running the Benchmark

### Prerequisites

1. Node.js 24+ installed
2. Vibe installed and configured (`vibe` command available)
3. For POC: Mistral API key set in `MISTRAL_API_KEY` environment variable
4. Dependencies installed: `npm install`

### Basic Usage

```bash
# Run the scaled benchmark with both POC and Vibe
node poc/exploration-benchmark/run-scaled-benchmark.mjs \
  --adapter-poc "node" \
  --arg-poc "poc/exploration-benchmark/mistral-adapter.mjs" \
  --adapter-vibe "node" \
  --arg-vibe "poc/exploration-benchmark/vibe-adapter.mjs" \
  --output /tmp/scaled-benchmark-results \
  --runs-per-series 10
```

### Options

- `--adapter-poc`: Executable for POC adapter
- `--arg-poc`: Arguments for POC adapter
- `--adapter-vibe`: Executable for Vibe adapter  
- `--arg-vibe`: Arguments for Vibe adapter
- `--output`: Output directory (required)
- `--budget`: Path to budget JSON file (optional)
- `--runs-per-series`: Number of runs per series (default: 10)
- `--timeout-ms`: Timeout in milliseconds (default: 120000)

### Example with Custom Budget

```bash
node poc/exploration-benchmark/run-scaled-benchmark.mjs \
  --adapter-poc "node" \
  --arg-poc "poc/exploration-benchmark/mistral-adapter.mjs" \
  --adapter-vibe "node" \
  --arg-vibe "poc/exploration-benchmark/vibe-adapter.mjs" \
  --output /tmp/scaled-benchmark-results \
  --budget custom-budget.json \
  --runs-per-series 5
```

Where `custom-budget.json` contains:
```json
{
  "iterations": 8,
  "calls": 32,
  "tokens": 32000,
  "durationMs": 60000
}
```

## Output Structure

The benchmark creates the following files in the output directory:

- `summary.json`: Overall summary with aggregated metrics
- `<id>.stdout.json`: Raw stdout from each run
- `<id>.meta.json`: Metadata and parsed results for each run

### Run ID Format

Run IDs follow the pattern: `s{series}-r{run}-{solution}-{seriesType}-{taskId}`

Examples:
- `s1-r1-poc-repetition-function`: First run, first series, POC, repetition series, function task
- `s2-r5-vibe-transfer-data-flow`: Fifth run, second series, Vibe, transfer series, data-flow task

## Memory Management (POC)

- **Repetition Series**: Memory directory is created once per series and reused across all runs
- **Transfer Series**: New memory directory is created for each run
- Memory is cleaned up after each series or run completes

## Session Isolation (Vibe)

- Each Vibe run gets a unique session ID
- Each run uses `--auto-approve` to avoid prompts
- Output directory is unique per run
- Environment variables are isolated per run

## Evaluation

Each run's output is automatically evaluated using the `evaluate.mjs` script, which checks that file references are valid and within the workspace.

## Analysis

The `summary.json` file contains comprehensive statistics:
- Per-solution, per-series metrics (median, min, max, total)
- Per-task metrics across all solutions and series
- Overall statistics

For analysis, focus on:
1. **Token efficiency**: Input/output tokens per correct answer
2. **Quality**: Number of correct proofs and coverage
3. **Cost**: Total cost divided by number of correct explorations
4. **Memory benefits**: Compare repetition vs transfer series for POC

## Notes

- The benchmark requires significant API credits for Vibe
- For POC, Mistral API credits are required
- Each full run (20 runs × 2 solutions × 3 tasks × 2 series) = 240 total runs
- Consider starting with `--runs-per-series 2` for testing
- Review results manually before drawing conclusions
- The verdict is always "non_concluant_sans_revue_manuelle" until manual review

## Files

- `run-scaled-benchmark.mjs`: Main benchmark runner
- `vibe-adapter.mjs`: Vibe adapter for headless mode
- `mistral-adapter.mjs`: POC adapter using Mistral API
- `tasks.json`: Repetition series tasks
- `README-SCALED.md`: This file
