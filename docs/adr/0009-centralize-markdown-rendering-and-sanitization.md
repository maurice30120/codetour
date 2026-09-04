---
status: proposed
---

# Centralize Markdown rendering and sanitization

CodeTour uses one shared description pipeline for every Playback Surface. That pipeline prepares CodeTour-specific links and references, renders Mermaid diagrams, and produces the same Markdown regardless of its destination. Native VS Code surfaces continue to receive this prepared Markdown because VS Code owns their rendering; extension-owned HTML surfaces, including the Expanded Description View for the active Tour Step, convert it through a directly declared Markdown engine and an explicit HTML sanitizer before display.

The Markdown engine and sanitizer are direct application dependencies rather than incidental transitive dependencies of Mermaid or packaging tools. This keeps rendering behavior versioned and testable at the CodeTour boundary, prevents a dependency update elsewhere from silently changing descriptions, and gives every extension-owned HTML surface the same allowlist for markup, attributes, URI schemes, and images.

## Considered options

- Relying on a Markdown engine brought transitively by another package was rejected because its presence and version are not part of CodeTour's dependency contract.
- Letting each webview choose and configure its own renderer was rejected because rendering and security rules would drift between Playback Surfaces.
- Replacing native VS Code Markdown rendering with generated HTML was rejected because native comments, hovers, tooltips, and notebook cells own their rendering lifecycle and capabilities.

## Consequences

All extension-owned HTML rendering must go through the shared renderer and sanitizer; a Playback Surface must not instantiate its own Markdown engine. Changes to rendering or the sanitizer allowlist are cross-surface behavior changes and require tests. Native surfaces may still differ visually where VS Code intentionally controls presentation, but they consume the same prepared Markdown semantics.
