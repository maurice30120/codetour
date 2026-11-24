# Pi agent smoke test

`src/agent/piAgentSmoke.test.ts` is the one check that runs a real Pi, and the
only one that can attest what no fake agent can prove: that the pinned ACP
client really negotiates with Pi's adapter, and that a Pi launched by CodeTour
really has only reading and searching tools. It is manual, opt-in, and never
blocks CI.

## What it needs

- `pi` and `pi-acp` on `PATH`. `pi-acp` is the verified ACP adapter (0.0.31
  was the version this test was written against) and `pi` is the agent it
  launches.
- A Pi that is already signed in (`pi auth login`). The test never
  authenticates: signing in stays the reader's own act (ADR 0048).
- A POSIX shell. On Windows CodeTour provides no launcher (ADR 0049), so the
  test skips instead of running Pi unrestricted.

## The command

From the repository root, after a compile:

```sh
npx tsc -p tsconfig.test.json
CODETOUR_PI_SMOKE=1 node --test dist/test/agent/piAgentSmoke.test.js
```

Without `CODETOUR_PI_SMOKE=1` the file is skipped, which is why the full suite
(`npm run test`, or `node --test dist/test/agent/*.test.js`) stays green on a
machine without Pi. The test also skips itself, with the reason printed, when
`pi`/`pi-acp` are missing, on Windows, and when Pi answers `authentication
required` — the states a maintainer cannot fix from a test run.

## What it verifies

| Test | What it proves |
| --- | --- |
| `Pi answers the probe and negotiates the pinned protocol version` | The manual handshake with `@agentclientprotocol/sdk` 1.8.0 asks protocol version `1` and Pi's adapter answers `1`, naming itself `pi-acp` with its version; `session/new` opens a session, announces a `model` configuration option, and announces thinking levels as its modes. The product's own Agent Probe then reports Pi `available` on the same entry. |
| `the launched Pi has only reading and searching tools` | The launcher `pi-acp` spawns is run with one extra `-e` argument, as a conversation would, and a small Pi extension reports `pi.getActiveTools()` on `session_start`. The effective surface must be exactly `read, grep, find, ls`: no `bash`, no `powershell`, no `edit`, no `write`. This is the tool surface **measured**, not the allowlist intended. |
| `Pi replays the requested model, confirms it, and answers a real question` | A first session reads the model Pi announces; a second session requests another value of the same provider and must confirm it, which is the rule the model selector follows (ADR 0048); the session then switches back to the announced model and answers one real question about a real file, with no forbidden tool kind executed. |
| `Pi's sign-in path is its declared terminal command` | `signInPlan` on the methods Pi's `initialize` announced yields a terminal plan with the declared command `pi-acp --terminal-login`. The command is read, never run: the test does not authenticate. |

Each test prints its evidence as a diagnostic line — the negotiated protocol
version, the effective tool names, the requested model, and the declared
sign-in command.

## Why it is manual

Every step above depends on the reader's machine: an installed Pi, a signed-in
account, configured providers, a reachable model. That is exactly why it cannot
live in CI, and why the deterministic suite keeps a fake ACP agent for
everything else. It is also why the test is bounded: every ACP request races a
deadline, the child process of the tool-surface step is killed by a timer, and
every spawned agent is disposed in a `finally` block, so a broken Pi fails the
file instead of hanging it.

## When it can be deleted

`pi-acp` gains a way to restrict Pi's tools itself (an argument, or a variable
it honours). At that point ADR 0049's launcher goes away, and the
tool-surface test follows it: the allowlist would then be the adapter's
argument rather than CodeTour's script.
