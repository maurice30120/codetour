# Exemple de Project Tour avec vue C4

Cet exemple montre le contenu complet d'un fichier `.tours/project.tour`. La
première étape donne une carte du système sans pointer vers un fichier ; les
étapes suivantes conduisent le lecteur vers le code qui justifie cette carte.

```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "Découvrir CodeTour IA",
  "description": "Un parcours du point d'entrée MCP jusqu'au rendu des descriptions enrichies dans l'extension VS Code.",
  "steps": [
    {
      "title": "Vue d'ensemble",
      "description": "CodeTour IA aide les développeurs à comprendre un projet grâce à des parcours guidés affichés dans Visual Studio Code. Un agent IA analyse le workspace et propose le contenu ; le serveur MCP local le valide et l'enregistre avant que l'extension ne le présente au lecteur.\n\n**Diagram — Vue contexte**\n\n```mermaid\nflowchart LR\n    Auteur[\"Auteur du tour — veut expliquer le projet\"]\n    Lecteur[\"Lecteur — veut comprendre le code\"]\n    Agent[\"Agent IA compatible MCP\"]\n    Systeme[\"CodeTour IA\"]\n    VSCode[\"Visual Studio Code\"]\n    Auteur -->|demande un parcours en langage naturel| Agent\n    Agent -->|propose le contenu via MCP stdio| Systeme\n    Systeme -->|affiche le parcours via API d'extension| VSCode\n    Lecteur -->|parcourt les étapes dans l'interface| VSCode\n```\n\n**Diagram — Conteneurs**\n\n```mermaid\nflowchart LR\n    Agent[\"Agent IA\"]\n    Lecteur[\"Lecteur\"]\n    subgraph Extension[\"Conteneur — extension VS Code\"]\n        Webview[\"Interface et rendu du tour\"]\n    end\n    subgraph Serveur[\"Conteneur — serveur MCP local\"]\n        MCP[\"Validation et création du tour\"]\n    end\n    subgraph Stockage[\"Conteneur — stockage workspace\"]\n        Tours[(\"Fichiers .tours/*.tour\")]\n    end\n    Agent -->|soumet une proposition via MCP stdio| MCP\n    MCP -->|écrit atomiquement au format JSON| Tours\n    Webview -->|lit le tour depuis le workspace| Tours\n    Lecteur -->|consulte les étapes dans VS Code| Webview\n```\n\n### Zones du workspace\n\n- Extension VS Code et interface : [`src/`](../src/)\n- Serveur MCP local : [`packages/mcp-server/`](../packages/mcp-server/)\n- Rendu Markdown et Mermaid partagé : [`packages/description-renderer/`](../packages/description-renderer/)"
    },
    {
      "title": "Le contrat du Project Tour",
      "description": "La description de l'outil indique à l'agent comment construire un parcours cohérent. Elle impose notamment une première étape d'orientation avant les ancres de code.",
      "file": "packages/mcp-server/src/server.ts",
      "pattern": "const PROJECT_TOUR_DESCRIPTION ="
    },
    {
      "title": "La validation des étapes",
      "description": "Le serveur vérifie ensuite chaque description et chaque locator avant toute écriture. Une ancre par `pattern` doit être une expression régulière sûre qui ne correspond qu'à un seul emplacement.",
      "file": "packages/mcp-server/src/validation.ts",
      "pattern": "export function validateSteps\\("
    },
    {
      "title": "Le rendu Mermaid partagé",
      "description": "Enfin, le renderer transforme les diagrammes Mermaid autorisés pour leur affichage dans le panneau de lecture. Le serveur réutilise ce même moteur hors ligne afin que validation et lecture acceptent la même syntaxe.",
      "file": "packages/description-renderer/src/render.ts",
      "pattern": "export function renderMermaidDiagram\\("
    }
  ]
}
```

La première étape ne contient ni `file` ni `directory` : elle oriente donc le
lecteur avant d'ouvrir le code. Le premier diagramme situe le système parmi ses
utilisateurs et ses dépendances externes ; le second descend au niveau des
frontières d'exécution et de stockage réellement présentes. Le mapping final
relie chaque zone aux répertoires visités ensuite.

La deuxième étape ouvre la définition du contrat de `create_project_tour`. Son
`pattern` cible une déclaration stable et unique, plutôt qu'un numéro de ligne
qui changerait dès qu'un commentaire est ajouté plus haut dans le fichier.

La troisième étape suit la proposition jusqu'à la validation des ancres. Là
encore, le nom de la fonction exportée fournit une ancre courte, explicite et
plus durable qu'une position absolue.

La dernière étape rejoint le renderer commun au serveur et à l'extension. Son
ancre désigne l'interface de rendu publique, ce qui termine le parcours sur le
code responsable du résultat visible par le lecteur.
