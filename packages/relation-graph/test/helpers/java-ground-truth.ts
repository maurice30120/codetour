/**
 * Hand-written ground truth for the Java fixture tree, in the exact format of
 * the validated C# prototype harness
 * (packages/mcp-server/prototype-csharp-shootout/ground-truth.mjs, reused for
 * the measurements of ticket #153): every row is a relation a developer would
 * confirm by reading the code. `certainty: "hard"` marks interface dispatch,
 * which a static rule pack can point at (toward the port, or as a `?` site
 * with candidates) but never prove.
 */

export interface JavaGroundTruthRow {
  from: string;
  to: string;
  kind: "call" | "new" | "super";
  certainty: "provable" | "hard";
}

export interface JavaGroundTruthCase {
  id: string;
  label: string;
  symbol: string;
  file: string;
  grepToken: string;
  question: string;
  expected: JavaGroundTruthRow[];
}

export const JAVA_CASES: JavaGroundTruthCase[] = [
  {
    id: "java-user-service",
    label: "Fixture Java — UserService",
    symbol: "UserService",
    file: "services/UserService.java",
    grepToken: "UserService",
    question:
      "Héritage explicite, champ d'interface (dispatch dur), this-calls, usages de classe et appelants dans un autre fichier.",
    expected: [
      { from: "RequestHandler.handleGetUser", to: "UserService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.auditUsers", to: "UserService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.handleGetUser", to: "UserService.getUser", kind: "call", certainty: "provable" },
      { from: "RequestHandler.auditUsers", to: "UserService.getUser", kind: "call", certainty: "provable" },
      { from: "UserService.constructor", to: "BaseService.constructor", kind: "super", certainty: "provable" },
      { from: "UserService.getUser", to: "UserService.validate", kind: "call", certainty: "provable" },
      { from: "UserService.getUser", to: "UserService.audit", kind: "call", certainty: "provable" },
      { from: "UserService.getUser", to: "IRepository.find", kind: "call", certainty: "hard" },
      { from: "UserService.audit", to: "IRepository.log", kind: "call", certainty: "hard" }
    ]
  },
  {
    id: "java-admin-service",
    label: "Fixture Java — AdminService (homonyme)",
    symbol: "AdminService",
    file: "services/AdminService.java",
    grepToken: "getUser",
    question:
      "Deux classes déclarent getUser(). L'appelant passe par des types déclarés localement : assertion, pointeur ambigu, ou silence ?",
    expected: [
      { from: "RequestHandler.handleGetUser", to: "AdminService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.handleGetUser", to: "AdminService.getUser", kind: "call", certainty: "provable" },
      { from: "AdminService.constructor", to: "BaseService.constructor", kind: "super", certainty: "provable" },
      { from: "AdminService.getUser", to: "IRepository.find", kind: "call", certainty: "hard" },
      { from: "AdminService.getUser", to: "IRepository.log", kind: "call", certainty: "hard" }
    ]
  },
  {
    id: "java-picker-dispatch",
    label: "Fixture Java — SlowPicker (dispatch dynamique)",
    symbol: "SlowPicker",
    file: "services/SlowPicker.java",
    grepToken: "getUser",
    question:
      "Un var initialisé par un ternaire polymorphe : aucune règle légère ne peut prouver l'appelant. La ligne ? avec candidats rend-elle l'entrant actionnable ?",
    expected: [
      { from: "RequestHandler.handleViaPicker", to: "SlowPicker.getUser", kind: "call", certainty: "hard" },
      { from: "SlowPicker.getUser", to: "User.constructor", kind: "new", certainty: "provable" }
    ]
  },
  {
    id: "java-picker-port",
    label: "Fixture Java — IPicker (dispatch vers le port)",
    symbol: "IPicker",
    file: "services/IPicker.java",
    grepToken: "IPicker",
    question:
      "Le receveur a le type de port déclaré : l'arête est-elle assertée vers le port (IPicker.getUser) avec un statut heuristic, jamais vers l'implémentation ?",
    expected: [
      { from: "RequestHandler.handleViaPort", to: "IPicker.getUser", kind: "call", certainty: "hard" }
    ]
  }
];
