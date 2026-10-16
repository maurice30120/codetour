# Package the native rasterizer per platform

CodeTour distributes a platform-specific VSIX containing the JavaScript loader and only the matching native binary of the pinned `@resvg/resvg-js` rasterizer, staged outside the bundled extension code. This resolves the packaging decision deferred by ADR 0007: omitting runtime dependencies breaks Mermaid playback, while including the complete dependency tree makes the extension unnecessarily large.

Each artifact is built on a matching operating-system and architecture host and verified for its target, runtime contents and packaging size. Supported targets are macOS, glibc Linux and Windows on x64 and arm64; supporting another runtime, including musl Linux, requires an explicit extension of the packaging matrix rather than assuming one universal VSIX will work everywhere.
