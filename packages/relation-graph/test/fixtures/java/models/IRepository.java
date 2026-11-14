package fixture.models;

/**
 * Repository port. Calls through this interface are the "hard" relations of
 * the ground truth: a static rule pack can point at the port, never prove the
 * implementation (spec #149 story 16).
 */
public interface IRepository {
    User find(int id);

    void log(long id);
}
