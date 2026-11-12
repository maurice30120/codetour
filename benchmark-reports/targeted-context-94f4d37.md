# Targeted Context Benchmark

Generated: 2026-11-12T15:03:30.051Z

> Token figures are **estimates** (~4 characters per token) of the text actually served to the
> Tour Generator. They are not billing data: no API or AI Credit measurement is involved.

## Environment

| Property | Value |
| --- | --- |
| Repository | codetour |
| Branch | fix/spec-92-uri-collision |
| Commit | 94f4d370289d32c7556e270267fd79eaa116759a |
| Base ref | 8f42a4ff2364d55e11196dce1c99cbfbf109963b |
| Head ref | HEAD |
| Workspace | /Users/dhuyet/Documents/POC/codetour-wt/spec92-fix |

## Results

| Scenario | Tour | Estimated tokens | Target | Verdict | Symbols | Files | Pages | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| changes-first-page | changes | 1,989 | — | no-target | 137 | 17 | 1 | 208 ms |
| changes-full-context | changes | 1,969 | < 150,000 | within-target | 137 | 19 | 1 | 208 ms |
| project-full-context | project | 1,220 | < 400,000 | within-target | 283 | 50 | 0 | 16 ms |

## Configuration

**Changes Tour (approach C)**

```json
{
  "enabled": true,
  "maxSymbols": 5000,
  "pageSize": 200,
  "maxFiles": 50,
  "maxDepth": 10,
  "includeExtensions": [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go"
  ],
  "excludeExtensions": [
    ".test.",
    ".spec.",
    ".d.ts"
  ],
  "includeDocumentation": true,
  "trackCost": true,
  "excludeNodeModules": true
}
```

**Project Tour (approach D)**

```json
{
  "enabled": true,
  "maxSymbolsPerFile": 50,
  "maxFiles": 50,
  "maxDepth": 10,
  "includeExtensions": [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".java",
    ".go",
    ".rs"
  ],
  "excludeExtensions": [
    ".test.",
    ".spec.",
    ".d.ts",
    ".min.js"
  ],
  "includeDocumentation": true,
  "trackCost": true,
  "rootDirectories": [
    "src",
    "lib",
    "packages",
    "app",
    "server"
  ],
  "excludeNodeModules": true
}
```

## Warnings

No truncation or exclusion was reported.

## Scope

- One repository, one commit pair: the result is reproducible, not a general claim.
- `changes-full-context` is the whole bounded context; `changes-first-page` is what one
  paginated read serves by default.
- The spec targets are checked against the full contexts (the cost of reading everything),
  which is the conservative comparison.
