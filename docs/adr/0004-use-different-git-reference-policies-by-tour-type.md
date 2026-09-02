# Use different Git reference policies by tour type

> **Superseded by [ADR-0010](0010-expose-a-single-create-tour-tool.md).** This decision is obsolete: the MCP server no longer performs any Git access and never writes a CodeTour `ref`; reference policies, when relevant, are now the Tour Generator's responsibility.

A Project Tour is generated without a CodeTour `ref` so it remains usable as the codebase evolves. By default, a Changes Tour records the exact analyzed `HEAD` commit SHA as its `ref`, and generation fails if `HEAD` changed after analysis; this trades editability across checkouts for a reproducible explanation whose file contents and Tour Anchors match the reviewed snapshot. When uncommitted changes are explicitly included, the Changes Tour has no `ref` and carries a warning that it describes a non-reproducible local state.
