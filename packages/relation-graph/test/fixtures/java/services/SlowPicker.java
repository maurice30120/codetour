package fixture.services;

import fixture.models.User;

/** Slow strategy: its getUser holds the `new User(...)` of the ground truth. */
public class SlowPicker implements IPicker {
    public User getUser(int id) {
        if (id % 5 != 0) {
            return null;
        }
        return new User("slow");
    }
}
