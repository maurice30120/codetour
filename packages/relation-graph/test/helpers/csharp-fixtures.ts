import type { SourceFile } from "../../src/index";

/**
 * C# ground-truth fixtures for the pack of ticket #152, ported verbatim from
 * the validated prototype (packages/mcp-server/prototype-csharp-shootout/
 * fixture/csharp, main working tree). Line numbers below are asserted by the
 * tests — edit with care. Three cases, same as prototype ground-truth.mjs:
 *   cs-user-service  — inheritance + interface dispatch + usages,
 *   cs-admin-service — same-name methods (homonym) + `using X = Y` alias,
 *   cs-picker-dispatch — polymorphic ternary, unprovable (the "?" case).
 */

export const CS_REQUEST_HANDLER_PATH = "Api/RequestHandler.cs";
export const CS_REQUEST_HANDLER = "using Fixture.Models;\n\nusing Fixture.Services;\n\nusing Admin = Fixture.Services.AdminService;\n\nnamespace Fixture.Api;\n\n/// <summary>\n/// Callers of both services. Calibrated with filler methods so that a grep\n/// baseline must read substantial files that mostly do not matter.\n/// </summary>\npublic class RequestHandler\n{\n    public string HandleGetUser(int id)\n    {\n        var repo = new DatabaseRepository();\n        var svc = new UserService(repo);\n        var user = svc.GetUser(id);\n        if (user == null)\n        {\n            var admin = new Admin();\n            var adminFallback = admin.GetUser(id);\n            return adminFallback == null ? \"none\" : \"admin:\" + adminFallback.Name;\n        }\n        var backup = new Admin();\n        var backupUser = backup.GetUser(id);\n        return (user.Name ?? \"?\") + \"/\" + (backupUser?.Name ?? \"-\");\n    }\n\n    public int AuditUsers(int id)\n    {\n        var repo = new DatabaseRepository();\n        var svc = new UserService(repo);\n        var found = svc.GetUser(id);\n        return found == null ? 0 : 1;\n    }\n\n    public string HandleViaPicker(bool fast, int id)\n    {\n        var picker = fast ? (IPicker)new FastPicker() : new SlowPicker();\n        var picked = picker.GetUser(id);\n        return picked?.Name ?? \"none\";\n    }\n\n    public string Render()\n    {\n        var lines = new List<string>\n        {\n            \"HandleGetUser\",\n            \"AuditUsers\",\n        };\n        for (var step = 0; step < 5; step++)\n        {\n            lines.Add(\"step-\" + step);\n        }\n        return string.Join(\"|\", lines);\n    }\n}\n";

export const CS_IREPOSITORY_PATH = "Models/IRepository.cs";
export const CS_IREPOSITORY = "namespace Fixture.Models;\n\n/// <summary>\n/// Repository port. Calls through this interface are the \"hard\" relations of the\n/// ground truth: a static rule pack can point at the port, never prove the impl.\n/// </summary>\npublic interface IRepository\n{\n    User? Find(int id);\n\n    void Log(long id);\n}\n";

export const CS_DATABASE_REPOSITORY_PATH = "Models/DatabaseRepository.cs";
export const CS_DATABASE_REPOSITORY = "namespace Fixture.Models;\n\nusing System.Text;\n\n/// <summary>Concrete port implementation. Long enough that reading it whole costs real tokens.</summary>\npublic class DatabaseRepository : IRepository\n{\n    private readonly StringBuilder _trace = new();\n    private long _sequence;\n\n    public User? Find(int id)\n    {\n        if (id <= 0)\n        {\n            return null;\n        }\n        if (id % 2 == 0)\n        {\n            _trace.Append(\"even\").Append(id);\n            return null;\n        }\n        _sequence++;\n        var label = \"user-\" + id + \"-\" + _sequence;\n        return new User(label);\n    }\n\n    public void Log(long id)\n    {\n        _trace.Append(\"log\").Append(id);\n    }\n\n    public string Dump()\n    {\n        var total = 0L;\n        for (var probe = 0; probe < 10; probe++)\n        {\n            total += probe * probe;\n        }\n        return _trace + \":\" + total;\n    }\n}\n";

export const CS_USER_PATH = "Models/User.cs";
export const CS_USER = "namespace Fixture.Models;\n\n/// <summary>Fixture entity. Small on purpose: not part of any token-saving debate.</summary>\npublic class User\n{\n    public string? Name { get; }\n\n    public User(string? name)\n    {\n        Name = name;\n    }\n}\n";

export const CS_BASE_SERVICE_PATH = "Services/BaseService.cs";
export const CS_BASE_SERVICE = "namespace Fixture.Services;\n\n/// <summary>Root of the fixture hierarchy: the `super` relation of the ground truth.</summary>\npublic class BaseService\n{\n    protected BaseService()\n    {\n    }\n\n    protected void Flush()\n    {\n    }\n}\n";

export const CS_USER_SERVICE_PATH = "Services/UserService.cs";
export const CS_USER_SERVICE = "using Fixture.Models;\n\nnamespace Fixture.Services;\n\n/// <summary>\n/// Main fixture case: inheritance (explicit base ctor), a declared interface\n/// field (hard dispatch), this-calls, and filler methods so that targeted\n/// slices are a minority of the file.\n/// </summary>\npublic class UserService : BaseService\n{\n    private readonly IRepository _repo;\n\n    private readonly int _maxAttempts;\n\n    public UserService(IRepository repo) : base()\n    {\n        _repo = repo;\n        _maxAttempts = 3;\n    }\n\n    public User? GetUser(int id)\n    {\n        var attempts = 0;\n        while (attempts < _maxAttempts)\n        {\n            if (!Validate(id))\n            {\n                return null;\n            }\n            var user = _repo.Find(id);\n            if (user != null)\n            {\n                Audit(id);\n                return user;\n            }\n            attempts++;\n        }\n        return null;\n    }\n\n    public int CountActiveUsers(int floor)\n    {\n        var total = 0;\n        for (var year = 2020; year < 2030; year++)\n        {\n            if (year >= floor)\n            {\n                total += year - floor;\n            }\n        }\n        return total;\n    }\n\n    public string Describe()\n    {\n        var parts = new List<string>\n        {\n            \"UserService\",\n            \"maxAttempts=\" + _maxAttempts,\n        };\n        for (var probe = 0; probe < 3; probe++)\n        {\n            parts.Add(\"probe\" + probe);\n        }\n        return string.Join(\", \", parts);\n    }\n\n    private bool Validate(int id)\n    {\n        return id > 0;\n    }\n\n    private void Audit(int id)\n    {\n        _repo.Log(id);\n    }\n}\n";

export const CS_ADMIN_SERVICE_PATH = "Services/AdminService.cs";
export const CS_ADMIN_SERVICE = "using Fixture.Models;\n\nnamespace Fixture.Services;\n\n/// <summary>\n/// Homonym fixture: declares GetUser like UserService, different semantics.\n/// The caller resolves it through a using-alias, which is the C# twist the\n/// rule pack must survive.\n/// </summary>\npublic class AdminService : BaseService\n{\n    private readonly IRepository _repo;\n\n    public AdminService(IRepository repo) : base()\n    {\n        _repo = repo;\n    }\n\n    public User? GetUser(int id)\n    {\n        if (id < 1000)\n        {\n            var user = _repo.Find(id);\n            _repo.Log(id);\n            return user;\n        }\n        return null;\n    }\n}\n";

export const CS_PICKERS_PATH = "Services/Pickers.cs";
export const CS_PICKERS = "using Fixture.Models;\n\nnamespace Fixture.Services;\n\n/// <summary>\n/// Strategy trio: one port, two interchangeable implementations. A caller that\n/// picks the implementation at runtime is the C# ambiguity that no light\n/// rule pack can prove -- the `?` line territory.\n/// </summary>\npublic interface IPicker\n{\n    User? GetUser(int id);\n}\n\npublic class FastPicker : IPicker\n{\n    public User? GetUser(int id)\n    {\n        return id < 100 ? new User(\"fast\") : null;\n    }\n}\n\npublic class SlowPicker : IPicker\n{\n    public User? GetUser(int id)\n    {\n        if (id % 5 != 0)\n        {\n            return null;\n        }\n        return new User(\"slow\");\n    }\n}\n";

export const CS_FIXTURES: SourceFile[] = [
  { path: CS_REQUEST_HANDLER_PATH, content: CS_REQUEST_HANDLER },
  { path: CS_IREPOSITORY_PATH, content: CS_IREPOSITORY },
  { path: CS_DATABASE_REPOSITORY_PATH, content: CS_DATABASE_REPOSITORY },
  { path: CS_USER_PATH, content: CS_USER },
  { path: CS_BASE_SERVICE_PATH, content: CS_BASE_SERVICE },
  { path: CS_USER_SERVICE_PATH, content: CS_USER_SERVICE },
  { path: CS_ADMIN_SERVICE_PATH, content: CS_ADMIN_SERVICE },
  { path: CS_PICKERS_PATH, content: CS_PICKERS }
];
