# CodeTour

CodeTour is a VS Code extension that records and plays back guided tours of a codebase, plus an MCP server through which an AI agent authors those tours.

## Language

**Tour Image**:
An image generated to illustrate one specific Tour, stored under `.tours/images/<tour-name>/` and referenced by that Tour's Markdown.
_Avoid_: Generated image, tour asset

**Project Image**:
An image that belongs to the codebase, stored outside `.tours/`; Tour generation may reference it but never create it.
_Avoid_: Workspace image, user image

**Forbidden tool**:
A tool call a Tour Step Conversation's agent is never allowed to run — one that writes, deletes, moves, or executes. When one runs anyway, the reader is told.
_Avoid_: Disallowed tool, unsafe tool

**Agent Profile**:
One ACP agent CodeTour knows how to start for a Tour Step Conversation, with a fixed rank in the local catalogue that decides which agent answers by default.
_Avoid_: Provider, ACP provider, backend, model host

**Agent Availability**:
Whether an Agent Profile can answer right now: unknown, not installed, installed but unverified, authentication required, available, or connection error. Only an available agent answers by default.
_Avoid_: Health, readiness, agent status

**Effective Model**:
The model an agent confirmed for the running session, which is what the reader sees; the reader's choice is a request until the agent confirms it.
_Avoid_: Selected model, current model, default model

**Effective Agent**:
The Agent Profile that a Tour Step Conversation's session is actually bound to, as the agent's own handshake confirmed it; before any session exists, the reader only has a preselected profile.
_Avoid_: Current provider, active agent, selected agent

**Agent Probe**:
The one bounded handshake that turns an Agent Profile's unknown or unverified availability into a state the reader can act on, without asking a question.
_Avoid_: Health check, ping, preflight

**Agent-Managed Model**:
The state of an agent that advertises no model selection at all: the reader chooses no model and the agent alone decides.
_Avoid_: Auto model, hidden model

**Narration Spell Dictionary**:
The fixed code constant mapping identifier tokens to the letter-by-letter spoken spelling the voice reads in their place.
_Avoid_: Acronym map, A–Z mapping, word list

**Knowledge Consolidation Operation**:
One `knowledge_save` call with an explicit `mode`: `create` (default) for a new entry, `replace` for rewriting one existing entry in full — valid or invalid — against the Knowledge Revision the caller read. A write is refused when that revision is absent, wrong or stale; every mode runs under one catalogue lock, and readers take none.
_Avoid_: Knowledge upsert, overwrite mode, knowledge merge

**Knowledge Revision**:
The SHA-256 of one Knowledge Entry's complete Markdown file bytes, exposed as an opaque token by discovery, by a read, by the catalogue projection served with the prompt, and by the Native Knowledge CLI. It is computed without validating the contract, so an entry whose evidence no longer verifies still has one, it reveals nothing of the body, of a cited path or of a source hash, and it moves with any modified byte so a write can be conditioned on the revision an agent actually read.
_Avoid_: version number, Etag, content hash, entry checksum
