---
status: proposed
---

# Run Tour Step Conversations over ACP as a read-only client

A Tour Step Conversation talks to the locally installed Vibe agent through the Agent Client Protocol (ACP), using the official `@agentclientprotocol/sdk` behind a small session layer in `src/agent/`. The session layer starts the agent's installed entry over its NDJSON stdio transport, selects and verifies the Ask mode before the first prompt, sends each question with the step's displayed code, path and description, streams the answer, and cancels the in-flight turn when the reader navigates or closes the conversation.

The CodeTour client is deliberately read-only: it announces only `fs/read_text_file`, refuses `fs/write_text_file` and all `terminal/*` requests with explicit JSON-RPC errors, grants permission only to read-like tools, and serves file reads confined to the session workspace. Ask mode is not trusted by name: mode changes are tracked from the agent's own `current_mode_update` notifications and prompts are refused outside Ask, and the tool calls the agent actually executes are verified against the forbidden kinds (edit, delete, move, execute) and reported on every turn outcome.

## Considered options

- Reusing Slopify's chat mechanism wholesale was rejected: its per-request ephemeral agent cycle, write permissions and Docker bridge contradict the read-only, reader-attached conversation this feature needs. Only the useful ACP mechanics are retained.
- Trusting the agent's Ask mode name was rejected: a mode name proves nothing about the tools actually executed, so the client verifies executed tool kinds and permission requests on every turn.
- Announcing write or terminal capabilities and policing their use was rejected: never announcing them removes the corresponding agent request paths outright, and the explicit refusal handlers keep non-compliant agents observable.
- Testing against a real Vibe was rejected for the deterministic suite: the tests spawn a fake ACP agent as a real child process at the transport boundary and assert on the wire content (capabilities, Ask selection, step context, refusals), while a manual trial with an installed Vibe confirms real compatibility.

## Consequences

The session layer is UI-less and sits behind one seam: an `AcpAgentTransport` with a stream, an exit signal and a dispose. Production spawns the installed Vibe entry (`spawnAcpAgent`); tests spawn the fake agent at the same process boundary. The chat surfaces of the Expanded Description View consume this layer later and must keep its read-only policy: no capability announcement, permission grant or tool-kind allowance may be widened without a new decision here.
