# Targeted Context Benchmark Report
**Spec #92, Ticket #118**
**Generated:** 11/11/2026, 10:24:25 AM

## 📊 Environment

| Property | Value |
|----------|-------|
| OS | darwin |
| Node.js Version | v26.0.0 |
| Workspace Root | /Users/damien/Documents/worktrees/spec-92-ticket-118 |
| Repository | codetour |
| SHA | benchmark-demo-sha |

## ⚙️ Benchmark Configuration

| Setting | Value |
|---------|-------|
| Iterations | 3 |
| Warmup | Yes |
| Collect Memory | Yes |
| Approaches | A, B, C, D |

## 🏆 Executive Summary

**Benchmarks Run:** 4
**Successful:** 4
**Failed:** 0

### Best by Metric

| Metric | Best Approach |
|--------|---------------|
| Most Symbols | A |
| Fastest | C |
| Lowest Cost | C |
| Most Efficient | C |
| Lowest Memory | B |

**Overall Winner:** C - Progressive MCP Exploration (Ticket #116)

### Performance Tiers

Based on efficiency (symbols per token per millisecond):

**Tier 1 (Top Performers):** C
**Tier 2 (Good):** B, D
**Tier 3 (Average):** A
**Tier 4 (Below Average):** None

## 🔍 Key Findings

- Approach A (Baseline) extracted the most symbols (50,000) but at the highest cost ($50.00) and longest duration (15,000ms).
- Approach B (Changes Tour) achieved significant cost savings (95%) and duration reduction (83%) compared to baseline.
- Approach C (Progressive MCP) had the best efficiency metrics and lowest cost ($1.50).
- Approach D (Project Tour) provided good symbol coverage (8,000) with moderate resource usage.
- All Targeted Context approaches (B, C, D) significantly outperformed the baseline (A) in terms of cost and efficiency.

## 💡 Recommendations

- 🏆 **Use Approach C (Progressive MCP Exploration) as the default** for best overall efficiency.
- Consider Approach B (Changes Tour) when working with specific branches where only changed files are relevant.
- Use Approach D (Project Tour) when comprehensive workspace context is needed.
- Avoid Approach A (Baseline) in production as it has the highest cost and resource usage.
- 🎯 **For Spec #92:** All Targeted Context implementations (B, C, D) from previous tickets demonstrate significant improvements over the baseline, validating the spec requirements.

## 📈 Detailed Results

### A: No Targeted Context (Baseline)

Traditional open-ended exploration without bounded context. The Tour Generator explores the entire codebase freely.

**Status:** ✅ SUCCESS

#### Metrics

| Metric | Value |
|--------|-------|
| Total Symbols | 50,000 |
| Total Files | 500 |
| Input Tokens | 5,000,000 |
| Output Tokens | 0 |
| Cache Tokens | 0 |
| Total Tokens | 5,000,000 |
| Estimated Cost | $50.00 |
| Duration | 15,000 ms |
| Context Size | 2.38 MB |
| MCP Tool Calls | 1,500 |
| API Requests | 2,500 |
| Peak Memory | 244.14 MB |
| Warnings | 0 |
| Errors | 0 |

---

### B: Basic Targeted Context - Changes Tour (Ticket #115)

Bounded context extraction from changed files only. Provides targeted symbols from files that changed between base and head commits.

**Status:** ✅ SUCCESS

#### Metrics

| Metric | Value |
|--------|-------|
| Total Symbols | 5,000 |
| Total Files | 50 |
| Input Tokens | 250,000 |
| Output Tokens | 0 |
| Cache Tokens | 0 |
| Total Tokens | 250,000 |
| Estimated Cost | $2.50 |
| Duration | 2,500 ms |
| Context Size | 244.14 KB |
| MCP Tool Calls | 100 |
| API Requests | 100 |
| Peak Memory | 61.04 MB |
| Warnings | 0 |
| Errors | 0 |

---

### C: Progressive MCP Exploration (Ticket #116)

Progressive, paginated context exploration. Allows incremental discovery of symbols across the codebase with MCP server pagination.

**Status:** ✅ SUCCESS

#### Metrics

| Metric | Value |
|--------|-------|
| Total Symbols | 3,000 |
| Total Files | 30 |
| Input Tokens | 150,000 |
| Output Tokens | 0 |
| Cache Tokens | 0 |
| Total Tokens | 150,000 |
| Estimated Cost | $1.50 |
| Duration | 3,500 ms |
| Context Size | 286.10 KB |
| MCP Tool Calls | 50 |
| API Requests | 50 |
| Peak Memory | 91.55 MB |
| Warnings | 0 |
| Errors | 0 |

---

### D: Project Tour Targeted Context (Ticket #117)

Comprehensive workspace-wide context. Extracts symbols from the entire project structure with configurable limits.

**Status:** ✅ SUCCESS

#### Metrics

| Metric | Value |
|--------|-------|
| Total Symbols | 8,000 |
| Total Files | 100 |
| Input Tokens | 400,000 |
| Output Tokens | 0 |
| Cache Tokens | 0 |
| Total Tokens | 400,000 |
| Estimated Cost | $4.00 |
| Duration | 4,000 ms |
| Context Size | 476.84 KB |
| MCP Tool Calls | 200 |
| API Requests | 200 |
| Peak Memory | 122.07 MB |
| Warnings | 0 |
| Errors | 0 |

---

## 🔄 Approach Comparisons

### A vs B

**Symbol Difference:** -45,000 (-90.0%)
**Token Difference:** -4,750,000 (-95.0%)
**Duration Difference:** -12,500 ms (-83.3%)
**Cost Difference:** -$47.50 (-95.0%)

**Efficiency Ratios:**
- Symbols per Token: 0.20x
- Symbols per ms: 0.40x
- Tokens per ms: 2.00x

**Verdict:** Approach B is ✅ BETTER than A

---

### A vs C

**Symbol Difference:** -47,000 (-94.0%)
**Token Difference:** -4,850,000 (-97.0%)
**Duration Difference:** -11,500 ms (-76.7%)
**Cost Difference:** -$48.50 (-97.0%)

**Efficiency Ratios:**
- Symbols per Token: 0.20x
- Symbols per ms: 0.86x
- Tokens per ms: 4.29x

**Verdict:** Approach C is ✅ BETTER than A

---

### A vs D

**Symbol Difference:** -42,000 (-84.0%)
**Token Difference:** -4,600,000 (-92.0%)
**Duration Difference:** -11,000 ms (-73.3%)
**Cost Difference:** -$46.00 (-92.0%)

**Efficiency Ratios:**
- Symbols per Token: 0.20x
- Symbols per ms: 2.00x
- Tokens per ms: 10.00x

**Verdict:** Approach D is ✅ BETTER than A

---

## 🧪 Methodology

This benchmark compares 4 different approaches to Targeted Context for Tour Generation in CodeTour (Spec #92).

**Approach A (Baseline):** No Targeted Context - Traditional open-ended exploration where the Tour Generator explores the entire codebase freely without bounds.

**Approach B (Ticket #115):** Basic Targeted Context for Changes Tour - Provides bounded context extraction from changed files only, focusing on files that changed between base and head commits.

**Approach C (Ticket #116):** Progressive MCP Exploration - Implements paginated context exploration, allowing incremental discovery of symbols across the codebase with MCP server pagination.

**Approach D (Ticket #117):** Project Tour Targeted Context - Comprehensive workspace-wide context extraction with configurable limits on symbols per file, number of files, and depth.

### Metrics Collected

- **Total Symbols:** Number of code symbols extracted for context
- **Total Files:** Number of files processed
- **Token Usage:** Input, output, and cache tokens used for context generation
- **Estimated Cost:** Estimated API cost based on token usage
- **Duration:** Time taken for context generation
- **Context Size:** Size of the generated context in bytes
- **MCP Tool Calls:** Number of MCP tool invocations
- **API Requests:** Number of API requests made
- **Peak Memory:** Peak memory usage during context generation

### Calculation Methods

- **Efficiency:** Symbols per token per millisecond (higher is better)
- **Cost:** Based on configured token pricing (default: $0.01 per 1000 input tokens, $0.03 per 1000 output tokens)
- **Improvement Percentage:** (Approach2 - Approach1) / Approach1 * 100

## ⚠️ Disclaimer

This is a sample report for demonstration purposes. The actual benchmark implementation in the TypeScript files will generate real reports based on actual codebase analysis.

Generated by CodeTour Targeted Context Benchmark Tool (Spec #92, Ticket #118)
