using Fixture.Models;

namespace Fixture.Services;

/// <summary>
/// Strategy trio: one port, two interchangeable implementations. A caller that
/// picks the implementation at runtime is the C# ambiguity that no light
/// rule pack can prove -- the `?` line territory.
/// </summary>
public interface IPicker
{
    User? GetUser(int id);
}

public class FastPicker : IPicker
{
    public User? GetUser(int id)
    {
        return id < 100 ? new User("fast") : null;
    }
}

public class SlowPicker : IPicker
{
    public User? GetUser(int id)
    {
        if (id % 5 != 0)
        {
            return null;
        }
        return new User("slow");
    }
}
