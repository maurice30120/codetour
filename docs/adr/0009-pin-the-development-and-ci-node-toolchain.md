# Pin the development and CI Node toolchain

The packaged MCP server integration test exposed a behavioral difference between npm 10 and npm 12: npm 10 ran the `prepare` script of a dependency supplied from an installed local directory despite `--ignore-scripts`, while npm 12 did not. CodeTour therefore uses Node.js 24.18.0 and npm 12.0.1 for local development, pull-request tests, and releases; `.nvmrc`, `.node-version`, the root `packageManager` and Volta declarations, and both GitHub Actions workflows record the same versions.

Changing either tool is an explicit toolchain upgrade: update every declaration together and run the full cross-platform workflow before accepting the change. This favors reproducible installs and tests over silently supporting whichever Node.js and npm versions happen to be present on a developer machine or runner.
