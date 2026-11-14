package fixture.api;

import fixture.models.DatabaseRepository;
import fixture.models.IRepository;
import fixture.models.User;
import fixture.services.AdminService;
import fixture.services.IPicker;
import fixture.services.UserService;
import fixture.services.FastPicker;
import fixture.services.SlowPicker;

/**
 * Callers of both services. Calibrated with filler methods so that a grep
 * baseline must read substantial files that mostly do not matter.
 */
public class RequestHandler {
    public User handleGetUser(int id) {
        IRepository repo = new DatabaseRepository();
        UserService svc = new UserService(repo);
        User user = svc.getUser(id);
        if (user == null) {
            AdminService admin = new AdminService(repo);
            User adminFallback = admin.getUser(id);
            return adminFallback;
        }
        return user;
    }

    public int auditUsers(int id) {
        IRepository repo = new DatabaseRepository();
        UserService svc = new UserService(repo);
        User found = svc.getUser(id);
        return found == null ? 0 : 1;
    }

    public User handleViaPicker(boolean fast, int id) {
        var picker = fast ? new FastPicker() : new SlowPicker();
        return picker.getUser(id);
    }

    public User handleViaPort(IPicker picker, int id) {
        return picker.getUser(id);
    }

    public String render() {
        StringBuilder lines = new StringBuilder();
        lines.append("HandleGetUser");
        lines.append("AuditUsers");
        for (int step = 0; step < 5; step++) {
            lines.append("step-").append(step);
        }
        return lines.toString();
    }
}
