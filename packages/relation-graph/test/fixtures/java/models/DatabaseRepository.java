package fixture.models;

/**
 * Concrete port implementation. Long enough that reading it whole costs real
 * tokens in the grep baseline.
 */
public class DatabaseRepository implements IRepository {
    private final StringBuilder trace = new StringBuilder();
    private long sequence;

    public User find(int id) {
        if (id <= 0) {
            return null;
        }
        if (id % 2 == 0) {
            trace.append("even").append(id);
            return null;
        }
        sequence++;
        String label = "user-" + id + "-" + sequence;
        return new User(label);
    }

    public void log(long id) {
        trace.append("log").append(id);
    }

    public String dump() {
        long total = 0L;
        for (int probe = 0; probe < 10; probe++) {
            total += (long) probe * probe;
        }
        return trace + ":" + total;
    }
}
