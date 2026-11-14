package fixture.services;

import fixture.models.User;

public class FastPicker implements IPicker {
    public User getUser(int id) {
        return id < 100 ? new User("fast") : null;
    }
}
