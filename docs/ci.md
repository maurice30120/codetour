# Plugin CI and downloads

Both workflows use Node.js 24.18.0 (from `.nvmrc`) and npm 12.0.1.
They run `npm ci` for the root and both packages using committed
`package-lock.json` files, then run the npm test and packaging scripts.

The Test workflow runs on every push and pull request. It runs the tests and
packages the VS Code extension for Linux, macOS and Windows. These builds verify
the VSIX but do not retain it as an Actions artifact.

To download an installable VSIX, publish a GitHub release. The Release workflow
checks out its tag, packages each platform and attaches the VSIX files to that
release. Download the file matching your platform from the release's **Assets**
section, then use **Extensions: Install from VSIX...** in VS Code.

To attach or rebuild files for an existing release, open **Actions > Release >
Run workflow**, select `main` and enter that release's tag. This manual run only
attaches VSIX files; it does not publish to the VS Marketplace. Publishing a new
release still publishes to the Marketplace if `VSCE_PAT` is configured, and
otherwise leaves the VSIX available on GitHub without requiring a secret.

Both workflows use standard GitHub-hosted runners and skip their jobs if the
repository becomes private. They store no Actions artifacts or dependency
caches, so these workflows do not add billable Actions storage. Release assets
do not use Actions artifact storage. Existing Actions artifacts and caches from
earlier runs are unaffected.

See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
for public-repository runner pricing and
[GitHub release storage limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)
for release downloads.
