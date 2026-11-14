// Hand-written ground truth for the C# shootout cases. Same convention as the
// first prototype: every row is a relation a developer would confirm by
// reading the code. `certainty: "hard"` marks interface dispatch, which a
// static rule pack can point at but never prove.

export const cases = [
  {
    id: "cs-user-service",
    label: "Fixture C# — UserService",
    symbol: "UserService",
    file: "Services/UserService.cs",
    grepToken: "UserService",
    question:
      "Héritage explicite, champ d'interface (dispatch dur), this-calls, usages de classe et appelants dans un autre fichier.",
    expected: [
      { from: "RequestHandler.HandleGetUser", to: "UserService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.AuditUsers", to: "UserService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.HandleGetUser", to: "UserService.GetUser", kind: "call", certainty: "provable" },
      { from: "RequestHandler.AuditUsers", to: "UserService.GetUser", kind: "call", certainty: "provable" },
      { from: "UserService.constructor", to: "BaseService.constructor", kind: "super", certainty: "provable" },
      { from: "UserService.GetUser", to: "UserService.Validate", kind: "call", certainty: "provable" },
      { from: "UserService.GetUser", to: "UserService.Audit", kind: "call", certainty: "provable" },
      { from: "UserService.GetUser", to: "IRepository.Find", kind: "call", certainty: "hard" },
      { from: "UserService.Audit", to: "IRepository.Log", kind: "call", certainty: "hard" },
    ],
  },
  {
    id: "cs-admin-service",
    label: "Fixture C# — AdminService (homonyme)",
    symbol: "AdminService",
    file: "Services/AdminService.cs",
    grepToken: "GetUser",
    question:
      "Deux classes déclarent GetUser(). L'appelant passe par un alias using et des var déclarés localement : assertion, pointeur ambigu, ou silence ?",
    expected: [
      { from: "RequestHandler.HandleGetUser", to: "AdminService.constructor", kind: "new", certainty: "provable" },
      { from: "RequestHandler.HandleGetUser", to: "AdminService.GetUser", kind: "call", certainty: "provable" },
      { from: "AdminService.constructor", to: "BaseService.constructor", kind: "super", certainty: "provable" },
      { from: "AdminService.GetUser", to: "IRepository.Find", kind: "call", certainty: "hard" },
      { from: "AdminService.GetUser", to: "IRepository.Log", kind: "call", certainty: "hard" },
    ],
  },
  {
    id: "cs-picker-dispatch",
    label: "Fixture C# — SlowPicker (dispatch dynamique)",
    symbol: "SlowPicker",
    file: "Services/Pickers.cs",
    grepToken: "GetUser",
    question:
      "Un var initialisé par un ternaire polymorphe : aucune règle légère ne peut prouver l'appelant. La ligne ? avec candidats rend-elle l'entrant actionnable ?",
    expected: [
      { from: "RequestHandler.HandleViaPicker", to: "SlowPicker.GetUser", kind: "call", certainty: "hard" },
      { from: "SlowPicker.GetUser", to: "User.constructor", kind: "new", certainty: "provable" },
    ],
  },
];
