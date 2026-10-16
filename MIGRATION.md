# Migrating from microsoft/codetour to CodeTour IA

[CodeTour IA](https://github.com/maurice30120/codetour) is an actively
maintained fork of [microsoft/codetour](https://github.com/microsoft/codetour).
The upstream project has been unmaintained since August 2025. This fork carries
the extension forward and adds AI-generated tours.

## Compatibility

Existing tours remain supported, with command links requiring migration:

- **`.tour` files** — the file format is unchanged. The schema was only
  extended with optional fields (`baseRef`, `baseFile`, `display`), so every
  existing tour loads as-is, including tours recorded with the original
  extension.
- **Command links** — replace `command:codetour.` with `command:codetourIA.`
  in tour descriptions, and `codetour.` with `codetourIA.` in step `commands`
  arrays and custom keyboard shortcut command IDs. For example,
  `codetour.startTour` becomes `codetourIA.startTour`. Legacy command aliases
  are not registered, to avoid conflicts with the original extension.
- **Default keyboard shortcuts, settings and tours stored in `.tours/`** — unchanged.
- **Public tour export and tour-by-URL links** — unchanged.

## What the fork adds

| Feature | Upstream | CodeTour IA |
| --- | --- | --- |
| Recording and playing back tours | Yes | Yes |
| AI-generated tours (MCP server) | No | Yes |
| Changes Tour in reproducible Git diffs | No | Yes |
| `workspacePath` for multi-project workspaces | No | Yes |
| Mermaid diagrams in tour descriptions | No | Yes (validated offline) |
| Hardened anchor validation (ReDoS, symlink races, commit-tree anchors) | No | Yes |
| Actively maintained | No (since August 2025) | Yes |

The MCP server exposes two tools, `create_project_tour` and
`create_changes_tour`, which let AI agents (VS Code / GitHub Copilot, Codex, or
any MCP client) generate validated tours. The server is confined to the
workspace, works fully offline, and never touches the network. Full contracts:
[packages/mcp-server/README.md](packages/mcp-server/README.md).

## How to switch

CodeTour IA is not published on the VS Code Marketplace yet. Releases are
distributed as VSIX packages on
[GitHub Releases](https://github.com/maurice30120/codetour/releases).

1. Uninstall the original CodeTour extension (`vsls-contrib.codetour`) to
   avoid duplicate menus and competing playback surfaces.
2. Download the latest `.vsix` from
   [GitHub Releases](https://github.com/maurice30120/codetour/releases).
3. Install it:

   ```bash
   code --install-extension codetour-<version>.vsix
   ```

4. Reload the window. Your tours are picked up exactly as before.

### MCP configuration (AI-generated tours)

- **VS Code / GitHub Copilot** — nothing to configure. The extension registers
  one confined server per workspace folder automatically.
- **Codex** — run `CodeTour IA: Configure MCP for Codex` from the Command
  Palette. A single global configuration then covers all projects.
- **Other MCP clients** — see
  [packages/mcp-server/README.md](packages/mcp-server/README.md) for a manual
  configuration example (the server takes its workspace from its working
  directory).

## Reporting issues and contributing

Issues and pull requests are welcome on
[maurice30120/codetour](https://github.com/maurice30120/codetour). The
[ROADMAP](ROADMAP.md) tracks planned features.
