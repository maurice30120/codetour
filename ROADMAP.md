# Roadmap

The goal is to provide AI-generated Tours that explain a project or the changes made to its code.

## Known bugs

- [ ] Automatically resize a Mermaid diagram image to the space available in the comment or the preview surface, without overflow or unreadable text.

## Priority 1 — Generation modes

### Project Tour

Explain the project's role, its structure, and its main execution paths.

- [ ] Define the minimum information expected in a Project Tour.
- [ ] Generate a progressive route from the entry point to the important modules.
- [ ] Verify that Tour Anchors remain relevant as the code evolves.
- [ ] Add a Project Tour example to the documentation.

### Review explanation

Present the remarks of a code review, their context, and the expected fixes.

- [ ] Define the review source: local comments, GitHub Issues, or pull request.
- [ ] Determine whether this feature should be a distinct mode or a specialized presentation of the Changes Tour.
- [ ] Associate each remark with a Tour Anchor and indicate its priority.
- [ ] Clearly distinguish problems, suggestions, and positive points.
- [ ] Define the behavior when a remark cannot be associated with a stable line.

### Changes Tour

Explain the intent, implementation, and impact of the changes since the divergence from the base branch.

- [ ] Detect and clearly display the base branch or reference used.
- [ ] Group changes by intent rather than file order.
- [ ] Report uncommitted changes when they are explicitly included.
- [ ] Highlight impacts on tests, configuration, and migrations.
- [ ] Add a Changes Tour example to the documentation.

## Priority 2 — Tour quality

- [ ] Define shared quality criteria: accuracy, concision, pedagogical order, and Tour Anchor relevance.
- [ ] Add integration tests for each mode and its main error cases.
- [ ] Verify generated Tours on several representative repository structures.
- [ ] Provide actionable errors when a file, a Git reference, or a Tour Anchor is invalid.
- [ ] Allow previewing and confirming the replacement of an existing generated Tour.

### VS Code extension unit tests

- [ ] Install and configure a unit test framework compatible with TypeScript and the extension modules.
- [ ] Separate business logic from direct VS Code dependencies so it can be tested without launching the editor.
- [ ] Create minimal adapters to simulate VS Code interfaces only where they actually vary across tests.
- [ ] Prioritize testing tour loading, validation, navigation, and updates.
- [ ] Test Tour Anchor resolution, including files or lines that become unavailable.
- [ ] Test preview content generation and the main Markdown edge cases.
- [ ] Test Git errors and the references associated with Changes Tours.
- [ ] Add a `test:unit` command and integrate it into the global `npm test` command.
- [ ] Run the unit tests in continuous integration and publish an actionable report on failure.
- [ ] Define an initial coverage target focused on critical modules, without imposing an artificial global percentage.

## Priority 3 — Simplification and maintenance

- [ ] Audit the tour-by-URL opening feature, its uses, and its dependencies.
- [ ] Remove it if it is no longer useful and if doing so simplifies the project's interface and implementation.
- [ ] Clean up the commands, dependencies, tests, and documentation items made useless by its removal.
- [ ] Centralize the validation and persistence shared by the generation modes behind a reduced interface.
- [ ] Document structuring decisions in an ADR when a choice modifies existing contracts.

## Later

- [ ] Offer branching Tours so readers can choose which topic to explore next according to their interests.
- [ ] Display Tour Steps on an interactive map of files and their relationships, with direct navigation to each step.
- [ ] Study Tour history without calling into question the stable generated files of the current version.
- [ ] Evaluate interactive and conditional Tours with explicit security rules.
- [ ] Collect local, anonymous metrics on generation errors before any possible telemetry.
