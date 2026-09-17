# Roadmap

The goal is to provide AI-generated Tours that explain a project or changes to
its code.

## Known issues

- [ ] Automatically resize Mermaid diagram images to fit the available space in
  comments and preview surfaces without overflow or unreadable text.

## Priority 1 — Generation modes

### Project Tour

Explain the project's purpose, structure, and main execution flows.

- [ ] Define the minimum information expected in a Project Tour.
- [ ] Generate a progressive path from the entry point to important modules.
- [ ] Check that Tour Anchors remain relevant as the code evolves.
- [ ] Add a Project Tour example to the documentation.

### Review explanation

Present code review comments, their context, and the expected corrections.

- [ ] Define the review source: local comments, GitHub Issues, or a pull request.
- [ ] Decide whether this should be a separate mode or a specialized Changes Tour presentation.
- [ ] Associate each comment with a Tour Anchor and indicate its priority.
- [ ] Clearly distinguish problems, suggestions, and positive points.
- [ ] Define behavior when a comment cannot be associated with a stable line.

### Changes Tour

Explain the intent, implementation, and impact of changes since divergence from
the base branch.

- [ ] Detect and clearly display the branch or base ref used.
- [ ] Group changes by intent rather than file order.
- [ ] Report uncommitted changes when they are explicitly included.
- [ ] Highlight impacts on tests, configuration, and migrations.
- [ ] Add a Changes Tour example to the documentation.

## Priority 2 — Tour quality

- [ ] Define shared quality criteria: accuracy, concision, teaching order, and Tour Anchor relevance.
- [ ] Add integration tests for each mode and its main error cases.
- [ ] Check generated Tours against several representative repository structures.
- [ ] Provide actionable errors when a file, Git ref, or Tour Anchor is invalid.
- [ ] Allow users to preview and then confirm replacement of an existing generated Tour.

### VS Code extension unit tests

- [ ] Install and configure a unit-test framework compatible with TypeScript and the extension modules.
- [ ] Separate domain logic from direct VS Code dependencies so it can be tested without starting the editor.
- [ ] Create minimal adapters for VS Code interfaces only where they actually vary in tests.
- [ ] Prioritize tests for Tour loading, validation, navigation, and updates.
- [ ] Test Tour Anchor resolution and files or lines that can no longer be found.
- [ ] Test preview-content generation and its main Markdown edge cases.
- [ ] Test Git errors and refs associated with Changes Tours.
- [ ] Add a `test:unit` command and include it in the global `npm test` command.
- [ ] Run unit tests in continuous integration and publish an actionable failure report.
- [ ] Define an initial coverage goal focused on critical modules without imposing an artificial global percentage.

## Priority 3 — Simplification and maintenance

- [ ] Audit Tour opening by URL, including its uses and dependencies.
- [ ] Remove it only if it is no longer useful and doing so simplifies the project's interface and implementation.
- [ ] Clean up commands, dependencies, tests, and documentation made obsolete by its removal.
- [ ] Centralize validation and persistence shared by generation modes behind a smaller interface.
- [ ] Document structural decisions in an ADR when a choice changes existing contracts.

## Later

- [ ] Study Tour history without changing the stable generated files of the current version.
- [ ] Evaluate interactive and conditional Tours with explicit security rules.
- [ ] Collect local, anonymous generation-error metrics before considering telemetry.
