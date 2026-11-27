# Expose two specialized tour generation tools

The MCP server exposes `create_project_tour` and `create_changes_tour` instead of one tool with a mode parameter. Distinct tools make each intent discoverable to AI agents and allow their contracts to evolve independently, while both delegate validation and persistence to shared internal logic. The AI agent analyzes and writes the tour content; the MCP server deterministically validates and persists it.
