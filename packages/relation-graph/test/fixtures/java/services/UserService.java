package fixture.services;

import fixture.models.IRepository;
import fixture.models.User;

/**
 * Main fixture case: explicit inheritance (super constructor call), a declared
 * interface field (hard dispatch toward the port), this-calls, and filler
 * methods so that targeted slices are a minority of the file.
 */
public class UserService extends BaseService {
    private final IRepository repo;
    private final int maxAttempts;

    public UserService(IRepository repo) {
        super();
        this.repo = repo;
        this.maxAttempts = 3;
    }

    public User getUser(int id) {
        int attempts = 0;
        while (attempts < maxAttempts) {
            if (!validate(id)) {
                return null;
            }
            User user = repo.find(id);
            if (user != null) {
                audit(id);
                return user;
            }
            attempts++;
        }
        return null;
    }

    public int countActiveUsers(int floor) {
        int total = 0;
        for (int year = 2020; year < 2030; year++) {
            if (year >= floor) {
                total += year - floor;
            }
        }
        return total;
    }

    public String describe() {
        StringBuilder parts = new StringBuilder();
        parts.append("UserService");
        parts.append("maxAttempts=").append(maxAttempts);
        for (int probe = 0; probe < 3; probe++) {
            parts.append("probe").append(probe);
        }
        return parts.toString();
    }

    private boolean validate(int id) {
        return id > 0;
    }

    private void audit(int id) {
        repo.log(id);
    }
}
