# English UI and code, model answers in the reader's language

CodeTour is an international tool: every user-facing string of the extension — webview chrome, editor decorations, status and error messages — and all code, comments and test names are written in English. The step conversation's agent answers are the deliberate exception: the responder answers in the language of the reader's prompt, and Tour content generated through the MCP server follows the same rule, so a French reader sees a French conversation inside an English chrome.

## Considered options

- Localizing the chrome per locale was rejected: the extension has no localization infrastructure and the audience is international; a single language keeps every chrome string testable through pinned English wording.
- Forcing English answers was rejected: answering in the reader's language is part of the guided-conversation promise, so the MCP server's guidance instructs the model to answer in the language of the user's request, not in English.
- Keeping the ad hoc French chrome was the status quo ante and is superseded here: the existing French strings are migrated by this decision's change, and new UI strings must be English from the start.

## Consequences

A bilingual chat — English chrome, non-English answer — is the expected rendering, not a bug. Tests pin exact English wording for chrome strings; model answers and Tour content are never asserted in English, and their fixtures may use any language.
