# Use different Git reference policies by tour type

A Project Tour is generated without a CodeTour `ref` so it remains usable as the codebase evolves. By default, a Changes Tour records the exact analyzed `HEAD` commit SHA as its `ref`, and generation fails if `HEAD` changed after analysis; this trades editability across checkouts for a reproducible explanation whose file contents and Tour Anchors match the reviewed snapshot. When uncommitted changes are explicitly included, the Changes Tour has no `ref` and carries a warning that it describes a non-reproducible local state.
