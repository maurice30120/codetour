# Retain Node.js and npm for development and CI

The attempted Bun package-manager migration is withdrawn. ADR 0011 remains authoritative: development, tests and releases use Node.js 24.18.0 and npm 12.0.1. All three packages commit npm package-lock.json files, and CI installs them with npm ci.

Using the same package manager locally and in CI avoids conflicting lockfiles and preserves npm packaging behavior. Scripts and packaging invoke npm; no Bun installation is required. Update the Node and npm pins together as described in ADR 0011.
