// Hand-written ground truth for the four prototype cases. This is the oracle:
// every row is a relation a developer would confirm by reading the code.
// `kind` is informative only; `certainty: "hard"` marks relations a static
// analyzer may legitimately leave unresolved (interfaces, dynamic dispatch).

export const cases = [
  {
    id: "ts-user-service",
    label: "Fixture TS — UserService",
    backend: "ts",
    symbol: "UserService",
    file: "fixture/ts/user-service.ts",
    grepToken: "getUser",
    question:
      "Une classe avec héritage, this.méthode(), un champ d'interface et des appelants dans un autre fichier.",
    expected: [
      { from: "handleRequest", to: "UserService.constructor", kind: "new", certainty: "provable" },
      { from: "handleRequest", to: "UserService.getUser", kind: "call", certainty: "provable" },
      { from: "auditUsers", to: "UserService.getUser", kind: "call", certainty: "provable" },
      { from: "UserService.constructor", to: "BaseService.constructor", kind: "super", certainty: "provable" },
      { from: "UserService.getUser", to: "UserService.validate", kind: "call", certainty: "provable" },
      { from: "UserService.getUser", to: "UserService.audit", kind: "call", certainty: "provable" },
      { from: "UserService.getUser", to: "Repository.find", kind: "call", certainty: "hard" },
      { from: "UserService.audit", to: "Repository.log", kind: "call", certainty: "hard" },
    ],
  },
  {
    id: "ts-admin-service",
    label: "Fixture TS — AdminService (homonyme)",
    backend: "ts",
    symbol: "AdminService",
    file: "fixture/ts/admin-service.ts",
    grepToken: "getUser",
    question:
      "Deux classes déclarent getUser(). Le graphe doit-il deviner, se taire, ou se tromper ?",
    expected: [
      { from: "handleRequest", to: "AdminService.getUser", kind: "call", certainty: "provable" },
    ],
  },
  {
    id: "py-user-service",
    label: "Fixture Python — UserService",
    backend: "py",
    symbol: "UserService",
    file: "fixture/py/models.py",
    grepToken: "get_user",
    question: "Le même cas de contrôle en Python, sans types statiques.",
    expected: [
      { from: "handle_request", to: "UserService.__init__", kind: "new", certainty: "provable" },
      { from: "handle_request", to: "UserService.get_user", kind: "call", certainty: "provable" },
      { from: "UserService.get_user", to: "UserService._validate", kind: "call", certainty: "provable" },
      { from: "UserService.get_user", to: "Repository.find", kind: "call", certainty: "hard" },
    ],
  },
  {
    id: "repo-orientation-warnings",
    label: "Dépôt réel — orientationStepWarnings",
    backend: "repo",
    symbol: "orientationStepWarnings",
    file: "packages/mcp-server/src/validation.ts",
    grepToken: "orientationStepWarnings",
    question:
      "Une fonction réelle de CodeTour : un appelant dans server.ts et un appel sortant dans le même fichier.",
    expected: [
      { from: "handleCreateProjectTour", to: "orientationStepWarnings", kind: "call", certainty: "provable" },
      { from: "orientationStepWarnings", to: "diagramNodeCount", kind: "call", certainty: "provable" },
    ],
  },
];
