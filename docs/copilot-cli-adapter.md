# Copilot CLI adapter (experimental)

The `/codetour` extension uses GitHub's experimental Copilot CLI extension API. It delegates discovery and playback to the standalone CodeTour CLI; it never changes Tours or Git state.

The project-scoped extension is in `.github/extensions/codetour/`. For other repositories, copy that directory to the user's Copilot extension directory `~/.copilot/extensions/codetour/`. Only install code you trust. Enable Copilot CLI's experimental extensions using `copilot --experimental`; extension availability also depends on its extension mode.

Make the standalone `codetour` command available on `PATH`, or set `CODETOUR_CLI` to the absolute executable path (or the absolute path to the built `dist/cli.js`). The project-scoped development copy can use this repository's `dist/cli.js` after a build. Packaging without a globally installed runtime is a separate acceptance criterion.

Start Copilot from a Git worktree, then use `/codetour`, `/codetour My Tour`, or `/codetour My Tour --renderer terminal`. The default renderer is HTML. With several Tours and no name, the adapter requests an interactive selection through the Copilot host. If the host does not expose selection, specify the name instead. A selected Tour is launched independently of the Copilot extension process.

Automated checks: run `npm run build`, `npx tsc -p tsconfig.test.json`, then `node --test dist/test/cli/cli.test.js test/copilot-adapter.test.mjs`. These do not establish that the experimental API works in a particular installed Copilot version. The required real Copilot launch and shutdown smoke test must be recorded separately.

GitHub's official documentation: https://docs.github.com/en/copilot/tutorials/create-an-extension
