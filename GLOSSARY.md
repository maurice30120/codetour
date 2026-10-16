# CodeTour

CodeTour is a VS Code extension that records and plays back guided tours of a codebase, plus an MCP server through which an AI agent authors those tours.

## Language

**Forbidden tool**:
A tool call a Tour Step Conversation's agent is never allowed to run — one that writes, deletes, moves, or executes. When one runs anyway, the reader is told.
_Avoid_: Disallowed tool, unsafe tool
