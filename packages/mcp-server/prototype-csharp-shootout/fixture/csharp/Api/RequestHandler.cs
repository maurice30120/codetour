using Fixture.Models;

using Fixture.Services;

using Admin = Fixture.Services.AdminService;

namespace Fixture.Api;

/// <summary>
/// Callers of both services. Calibrated with filler methods so that a grep
/// baseline must read substantial files that mostly do not matter.
/// </summary>
public class RequestHandler
{
    public string HandleGetUser(int id)
    {
        var repo = new DatabaseRepository();
        var svc = new UserService(repo);
        var user = svc.GetUser(id);
        if (user == null)
        {
            var admin = new Admin();
            var adminFallback = admin.GetUser(id);
            return adminFallback == null ? "none" : "admin:" + adminFallback.Name;
        }
        var backup = new Admin();
        var backupUser = backup.GetUser(id);
        return (user.Name ?? "?") + "/" + (backupUser?.Name ?? "-");
    }

    public int AuditUsers(int id)
    {
        var repo = new DatabaseRepository();
        var svc = new UserService(repo);
        var found = svc.GetUser(id);
        return found == null ? 0 : 1;
    }

    public string HandleViaPicker(bool fast, int id)
    {
        var picker = fast ? (IPicker)new FastPicker() : new SlowPicker();
        var picked = picker.GetUser(id);
        return picked?.Name ?? "none";
    }

    public string Render()
    {
        var lines = new List<string>
        {
            "HandleGetUser",
            "AuditUsers",
        };
        for (var step = 0; step < 5; step++)
        {
            lines.Add("step-" + step);
        }
        return string.Join("|", lines);
    }
}
