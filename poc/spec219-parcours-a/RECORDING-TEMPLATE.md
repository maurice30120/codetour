# RECORDING-TEMPLATE — parcours A (fill after the single attempt)

This template defines the fields the filled `RECORDING.md` must contain.
Honesty rules from `PROTOCOL.md` apply: absent values are recorded as absent,
never as zero; a missing prerequisite is a blocker, never a skipped step.

## 1. Identification

| Field | Value |
| --- | --- |
| Ticket / spec | (parent spec and the frozen request it pins) |
| Repository / commit | (worktree path and pinned commit) |
| Direct agent identity | (recorded exactly as mandated by the protocol) |
| Deviations from the protocol | (empty if none) |

## 2. Timing

| Field | Value |
| --- | --- |
| start (request receipt) | ISO timestamp |
| finish (first MCP `status: "created"`) | ISO timestamp |
| elapsed (finish − start) | (duration) |

## 3. Tour artifact

| Field | Value |
| --- | --- |
| file name in `.tours/` | |
| step count | |
| opens / parses as JSON | |
| anchors resolve at the pinned commit | (checked, per-anchor findings) |
| Mermaid diagrams validated by MCP | (status "validated"/warnings) |
| artifact copied into worktree at | |

## 4. Coverage of the request

| Requested topic | Presented as step |
| --- | --- |
| CLI entry point | (step title / number) |
| explore model node | |
| tool dispatch | |
| forged-call rejection | |
| observation masking | |

## 5. Quality findings (human review)

- (each defect: step, claim, actual code facts, severity)

## 6. Result

| Field | Value |
| --- | --- |
| status | completed / failed |
| usable artifact | (yes/no; if no, the named blocker) |
