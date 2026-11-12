# User Guide: Hybrid Targeted Context

*Part of Spec: Hybrid Targeted Context*  
*Date: 11 November 2026*

## Overview

The Hybrid Targeted Context system automatically selects the optimal approach for generating CodeTours based on the type of tour requested:

- **Approach C (Progressive MCP)**: Optimized for **Changes Tours** (PR reviews, diff analysis)
- **Approach D (Project Tour)**: Optimized for **Project Tours** (codebase discovery, architecture reviews)

This guide explains when to use each approach, how the automatic detection works, and how to configure the system for your needs.

---

## Choosing Between Changes Tour and Project Tour

### Changes Tour (Approach C)

**Use for:**
- Reviewing Pull Requests (PRs)
- Analyzing code changes and diffs
- Understanding what changed between two commits
- Quick, focused code reviews

**Characteristics:**
- ✅ **Token efficient**: 1,969 estimated tokens for the whole context on `codetour` (target < 150K); the 97% reduction vs baseline is unmeasured
- ✅ **Fast**: 203 ms measured, target < 3 seconds
- ✅ **Focused**: Only analyzes changed files
- ✅ **Progressive**: Supports pagination for large changesets

**When to use:**
- You have a specific PR or commit range to review
- You want to understand the impact of changes
- You need to validate that changes meet requirements
- Token cost is a concern

### Project Tour (Approach D)

**Use for:**
- Onboarding new team members
- Understanding project architecture
- Answering architectural questions
- Exploring a new codebase

**Characteristics:**
- ✅ **Comprehensive**: Covers entire workspace
- ✅ **Structured**: Provides architectural overview
- ✅ **Informative**: Includes key files and symbols
- ⚠️ **Higher cost**: 983 estimated tokens on `codetour` (target < 400K); the 92% reduction vs baseline is unmeasured

**When to use:**
- You're new to a project
- You need to understand the system design
- You want to explore the codebase structure
- You're documenting the architecture

---

## Comparison Table: Approach C vs D

| Feature | Approach C (Changes Tour) | Approach D (Project Tour) |
|---------|---------------------------|---------------------------|
| **Primary Use Case** | PR reviews, diff analysis | Codebase discovery, architecture |
| **Scope** | Changed files only | Entire workspace |
| **Token Budget (target)** | < 150K tokens | < 400K tokens |
| **Time (target)** | < 3 seconds | < 4 seconds |
| **Token Reduction (target)** | 97% vs baseline — unmeasured | 92% vs baseline — unmeasured |
| **Configuration** | maxSymbols: 5000, pageSize: 200 | maxFiles: 50, maxSymbolsPerFile: 50 |
| **Pagination** | ✅ Yes (progressive exploration) | ❌ No |
| **Root Directories** | N/A | src, lib, packages, app, server |

> The token and time figures are **targets from the spec**, not measurements. No real benchmark has
> been run yet (ticket 07).

---

## Automatic Detection

The system **automatically** detects which approach to use based on the request parameters:

### Detection Rules

| baseRef | headRef | Detected Type | Approach Used |
|---------|---------|---------------|---------------|
| Present | Present | Changes Tour | C (Progressive MCP) |
| Present | Absent | Project Tour | D (Project Tour) |
| Absent | Present | Project Tour | D (Project Tour) |
| Absent | Absent | Project Tour | D (Project Tour) |

### Example Requests

#### Changes Tour (Approach C)
```typescript
// MCP resource request with both refs
codetour://context/changes-tour/a1b2c3d/e4f5g6h

// Or via tool
create_changes_tour({
  baseRef: "a1b2c3d",
  headRef: "e4f5g6h",
  // ... other parameters
})
```

#### Project Tour (Approach D)
```typescript
// MCP resource request without refs
codetour://context/project-tour

// Or via tool
create_project_tour({
  // No baseRef or headRef
  // ... other parameters
})
```

---

## MCP Resources

The Tour type selects the approach; there is no separate "unified" resource to
opt into. Reading the Changes Tour context gives approach C, reading the Project
Tour context gives approach D.

#### Changes Tour Context (approach C)

- **Base URI**: `codetour://context/changes-tour/{baseRef}/{headRef}` — serves page 1 with 200 symbols
- **Paginated URI**: `codetour://context/changes-tour/{baseRef}/{headRef}?page={page}&pageSize={pageSize}`
- **Parameters**:
  - `baseRef` (required): Base commit SHA
  - `headRef` (required): Head commit SHA
  - `page` (paginated URI only, default: 1): Page number
  - `pageSize` (paginated URI only, default: 200): Items per page
- **Approach**: C (Progressive MCP)
- **Configuration**: maxSymbols: 5000, pageSize: 200, maxFiles: 50, excludeNodeModules: true, trackCost: true

The MCP SDK's URI templates require every declared query parameter, so pagination
has its own template. Omit the query to get the default first page.

**Example:**
```
GET codetour://context/changes-tour/abc123/def456
GET codetour://context/changes-tour/abc123/def456?page=2&pageSize=200
```

#### Project Tour Context (approach D)

- **URI**: `codetour://context/project-tour`
- **Parameters**: None (uses workspace root)
- **Approach**: D (Project Tour)
- **Configuration**: maxFiles: 50, maxSymbolsPerFile: 50, trackCost: true

**Example:**
```
GET codetour://context/project-tour
```

### Generation Prompt Resources

The generation prompts stay reachable at their own URIs:

- `codetour://generate/changes-tour/{reviewMode}` - Changes Tour generation prompt
- `codetour://generate/project-tour` - Project Tour generation prompt

**Note**: the `codetour://generate/*` URIs serve generation prompts; the
`codetour://context/*` URIs serve the bounded context itself.

---

## Configuration

### Approach C Configuration (Changes Tours)

**Default Configuration:**
```typescript
{
  enabled: true,
  maxSymbols: 5000,
  pageSize: 200,
  maxFiles: 50,
  excludeNodeModules: true,
  includeExtensions: [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go"
  ],
  excludeExtensions: [
    ".test.", ".spec.", ".d.ts"
  ],
  includeDocumentation: true,
  trackCost: true
}
```

By default the resource serves one page of 200 symbols. To read a specific page, use the
paginated URI: `codetour://context/changes-tour/{baseRef}/{headRef}?page=1&pageSize=200`.

**Customization:**
```typescript
import { getApproachCConfig } from './targeted-context/hybrid-config';

const customConfig = getApproachCConfig({
  maxSymbols: 10000, // Increase for larger PRs
});
```

### Approach D Configuration (Project Tours)

**Default Configuration:**
```typescript
{
  enabled: true,
  maxFiles: 50,
  maxSymbolsPerFile: 50,
  maxDepth: 10,
  includeExtensions: [
    ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs"
  ],
  excludeExtensions: [
    ".test.", ".spec.", ".d.ts", ".min.js"
  ],
  includeDocumentation: true,
  trackCost: true,
  rootDirectories: [
    "src", "lib", "packages", "app", "server"
  ],
  excludeNodeModules: true
}
```

**Customization:**
```typescript
import { getApproachDConfig } from './targeted-context/hybrid-config';

const customConfig = getApproachDConfig({
  maxFiles: 100,       // Scan more files
  maxSymbolsPerFile: 100, // More symbols per file
  rootDirectories: ["src", "lib", "custom-dir"],
});
```

---

## Use Cases and Examples

### Use Case 1: PR Review with Changes Tour

**Scenario**: You're reviewing a PR and want to understand the changes.

**Request:**
```typescript
// Using the context resource
GET codetour://context/changes-tour/abc123/def456
```

**Result:**
- Approach C is automatically selected
- Only changed files are analyzed
- Symbols are extracted with pagination support
- Token cost target: 50-150K tokens (unmeasured)
- Time target: < 3 seconds (unmeasured)

**What you get:**
- List of changed files
- Key symbols (functions, classes, variables) in each file
- Their locations and documentation
- Pagination for large changesets

### Use Case 2: New Project Onboarding

**Scenario**: You're joining a new project and need to understand the codebase.

**Request:**
```typescript
// Using the context resource
GET codetour://context/project-tour
```

**Result:**
- Approach D is automatically selected
- Entire workspace is scanned
- Key files from src/, lib/, packages/, app/, server/ are analyzed
- Token cost target: 200-400K tokens (unmeasured)
- Time target: < 4 seconds (unmeasured)

**What you get:**
- Comprehensive list of source files
- Language breakdown
- Largest and most symbolic files
- Key symbols organized by file
- Architectural overview

### Use Case 3: Custom Configuration

**Scenario**: You have a large project and need more context.

**Request:**
```typescript
import { getApproachDConfig } from './targeted-context/hybrid-config';
import { extractProjectTargetedContext } from './targeted-context/project-context-extractor';

const config = getApproachDConfig({
  maxFiles: 100,
  maxSymbolsPerFile: 75,
  rootDirectories: ["src", "lib", "packages"],
});

const result = await extractProjectTargetedContext(ctx, config);
```

---

## Performance Metrics

> Measured on the `codetour` repository at commit `fc62fbf` (all figures in
> `benchmark-reports/targeted-context-fc62fbf.md`). Tokens are **estimates**
> (~4 characters per token) of the text served, not billing data. One repository and one
> commit pair: reproducible, not a general claim.

### Changes Tours (Approach C)

| Metric | Target | Measured |
|--------|--------|----------|
| Token Cost (whole bounded context) | < 150K | ✅ 1,969 est. tokens |
| Duration | < 3 seconds | ✅ 203 ms |
| Token Reduction vs baseline | > 95% | ❌ not measured (no baseline harness) |

### Project Tours (Approach D)

| Metric | Target | Measured |
|--------|--------|----------|
| Token Cost | < 400K | ✅ 983 est. tokens |
| Duration | < 4 seconds | ✅ 12 ms |
| Token Reduction vs baseline | > 90% | ❌ not measured (no baseline harness) |

Regenerate with `npm run benchmark:targeted-context`; add `--check` to fail when a
target is exceeded. The extraction ran on a small diff (19 files, 137 symbols), so a
single page held everything: pagination shows its benefit only past `pageSize`.

---

## Backward Compatibility

All existing functionality remains unchanged:

- ✅ Existing MCP resources continue to work
- ✅ Existing tools (`create_changes_tour`, `create_project_tour`) unchanged
- ✅ Original configurations still work
- ✅ No breaking changes to the API

The new unified resources are **additive** - they provide a better default experience but don't replace existing functionality.

---

## Troubleshooting

### Detection Issues

**Problem**: Tour type is not being detected correctly.

**Solution**: Ensure you're providing the correct parameters:
- For Changes Tours: Both `baseRef` AND `headRef` must be present
- For Project Tours: Either omit both refs or provide only one

### High Token Cost

**Problem**: Context generation is using too many tokens.

**Solution**: Adjust the configuration:
- For Changes Tours: Reduce `maxSymbols` or `pageSize`
- For Project Tours: Reduce `maxFiles` or `maxSymbolsPerFile`

### Slow Performance

**Problem**: Context generation is taking too long.

**Solution**:
- Reduce the scope (fewer files, fewer symbols)
- Exclude more file types
- Limit the root directories for Project Tours

### Missing Files

**Problem**: Important files are not being included.

**Solution**:
- For Project Tours: Add the directory to `rootDirectories`
- For both: Add the file extension to `includeExtensions`
- Check that the file isn't being excluded by `excludeExtensions`

---

## API Reference

### Tour Type Detection

```typescript
import { detectTourType, getApproachForTourType } from './targeted-context/tour-type-detector';

// Detect tour type from parameters
const result = detectTourType({
  baseRef: 'abc123',
  headRef: 'def456'
});
// result.tourType = 'changes-tour'
// result.isCertain = true
// result.reason = 'Both baseRef and headRef are present...'

// Get the approach to use
const approach = getApproachForTourType(result.tourType);
// approach = 'C'
```

### Configuration Getters

```typescript
import {
  getApproachCConfig,
  getApproachDConfig,
  APPROACH_C_CONFIG,
  APPROACH_D_CONFIG
} from './targeted-context/hybrid-config';

// Get default configurations
const configC = getApproachCConfig();
const configD = getApproachDConfig();

// Get with overrides
const customConfigC = getApproachCConfig({
  maxSymbols: 10000
});
```

---

## Additional Resources

- [Spec: Hybrid Targeted Context](../specs/spec-hybrid-targeted-context.md)
- [Ticket #01: Tour Type Detection](../tickets/hybrid-targeted-context/01-detection-automatique-type-tour.md)
- [Ticket #02: Approach C Configuration](../tickets/hybrid-targeted-context/02-config-c-par-defaut-changes-tours.md)
- [Ticket #03: Approach D Configuration](../tickets/hybrid-targeted-context/03-config-d-par-defaut-project-tours.md)
- [Ticket #04: MCP Resource for Changes Tour](../tickets/hybrid-targeted-context/04-ressource-mcp-changes-tour.md)
- [Ticket #05: MCP Resource for Project Tour](../tickets/hybrid-targeted-context/05-ressource-mcp-project-tour.md)
- [Ticket #06: User Documentation (this file)](../tickets/hybrid-targeted-context/06-documentation-utilisateur.md)
- [Ticket #07: Benchmark Validation](../tickets/hybrid-targeted-context/07-benchmark-validation.md)

---

*Document generated on 11 November 2026*
