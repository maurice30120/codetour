> Historical decision: superseded by [spec #304](https://github.com/maurice30120/codetour/issues/304), which removes CodeTour memory without migration.

# Persist reusable research knowledge as Memory Functions and Memory Methods

The Research Harness memory held only Memory Functions, which forces every reusable finding to be a deterministic TypeScript operation even when it is really a search method needing interpretation. We add a second Memory Entry kind, the Memory Method: short Markdown instructions that the agent reads and interprets, never executes. Both kinds live in one Memory Catalogue, are discovered together, and are created only by a Consolidation Run, which picks function, method or nothing per finding.

The kinds stay separate rather than turning methods into functions or functions into methods, because their cost and failure profiles differ: functions are cheap to reuse but costly to generate and validate, methods are cheap to create but cost tokens each time they are read. Whether the hybrid pays off is decided by a four-mode benchmark (Baseline, Functions, Methods, Hybrid); no gain is a valid result and would mean dropping a kind. See spec #210.
