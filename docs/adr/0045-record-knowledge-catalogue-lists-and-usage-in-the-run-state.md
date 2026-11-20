# Record Knowledge catalogue lists and usage in the run state

ADR 0044 made discovery serve only verified Knowledge contracts and report
every failing entry under `invalid`. That answer is consumed once, by the agent,
and then lost: after a run nobody can tell how many entries were usable, which
ones were broken and why, or which entries the run actually read. ADR 0042 built
an additive observability block for model usage and drew its rule — the newest
snapshot replaces the previous one, and an unreadable source records
`observed:false` instead of a figure. **This decision applies that rule to
Knowledge: the MCP server records, in the run state, the verified and invalid
sets the agent's own `knowledge_list` returned, plus the entries whose body
`knowledge_read` served.**

**No second verification.** The block is a recording of work already done
(ADR 0044 verifies at discovery), not a new scan. `knowledge_list` and
`knowledge_read` gain an optional `runId`; when it is present and valid, the
page the agent just received is merged into `.tours/.log/codetour-run-<runId>.json`.
A run that never lists has no block, and that absence means "not measured",
never "zero entries".

**Merge rules, chosen for one question each.** Verified names accumulate as a
union across listings, because a targeted `query` listing is a subset and the
union is the only set the agent could have chosen from; `validTotal` keeps the
largest total observed and `complete` is true only when one listing was
untruncated, so a partially seen catalogue never claims completeness. The
`invalid` set is the **latest** listing's, not a union: ADR 0044 always returns
it in full regardless of pagination, so one listing describes it, and taking the
latest avoids branding an entry the run repaired as still broken. `used` holds
the distinct names whose `knowledge_read` returned `status: "valid"`; a refusal
is not a use. Call counts stay in ADR 0042's `metrics.calls`, so no figure has
two homes.

**Written by the MCP, never by a guard.** The server already owns every other
run-state field it can authenticate (`recordTourCreated`,
`recordConsolidation`), and it is the only process that sees both the tool call
and its verified answer. Putting the block there means the Copilot plugin needs
no new dependency on the hashing library, the Pi guard stays a reader, and both
hosts get the same facts for free. The cost is bounded and local: zero hashing
beyond what ADR 0044 already does, at most one merge per Knowledge call, under
the existing cross-process lock.

**Additive, therefore safe.** The field is optional and versioned like
`metrics`; `isRunState` accepts its absence, no reader treats a missing block as
an empty catalogue, and the guard never reads it. Compatibility with existing
Copilot installations is the constraint: an older run-state file stays valid,
and an older reader keeps working against a newer file.

**Consequences.** Two displays follow the same text: Pi notifies at the end of
the run, Copilot appends a clause to the `stderr` line `agentStop` already
prints. Invalid entries are always listed with their reason (a list of actions
must be complete); verified names are capped at ten in the display while the
run state keeps them all. The block is observability only: it never creates a
Tour, never closes a run, and a missing or malformed block never changes a
decision.
