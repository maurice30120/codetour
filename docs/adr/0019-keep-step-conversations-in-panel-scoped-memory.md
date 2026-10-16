# Keep Tour Step Conversations in panel-scoped memory

Each Tour Step has its own conversation, held in extension memory for the lifetime of the Expanded Description View rather than written into Tour files or restored from persistent storage. Navigating between steps preserves their exchanges, and successful exchanges supply follow-up history, so a question stays grounded in its own step instead of inheriting a single shared tour-wide transcript.

Closing the reading panel clears the conversations and releases their agent resources; reopening it starts fresh. This deliberately gives up durable chat history and continuity across panel closures in exchange for keeping transient discussion separate from the versioned Tour and avoiding a conversation-storage and migration contract. Extending ADRs 0013 and 0014, reuse of an agent session must preserve this separation between step histories.
