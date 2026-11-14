package fixture.services;

import fixture.models.User;

/**
 * Strategy port. A caller holding a declared IPicker is asserted toward this
 * port with a heuristic status (spec #149 story 16); a caller that picks the
 * implementation at runtime (var + ternary) is the `?` line territory.
 */
public interface IPicker {
    User getUser(int id);
}
