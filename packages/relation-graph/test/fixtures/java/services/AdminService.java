package fixture.services;

import fixture.models.IRepository;
import fixture.models.User;

/**
 * Homonym fixture: declares getUser like UserService, different semantics. The
 * caller resolves it through its declared type, which is the Java twist the
 * rule pack must survive (Java has no using-alias; the declared type is the
 * alias).
 */
public class AdminService extends BaseService {
    private final IRepository repo;

    public AdminService(IRepository repo) {
        super();
        this.repo = repo;
    }

    public User getUser(int id) {
        if (id < 1000) {
            User user = repo.find(id);
            repo.log(id);
            return user;
        }
        return null;
    }
}
