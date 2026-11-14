namespace Fixture.Models;

/// <summary>Fixture entity. Small on purpose: not part of any token-saving debate.</summary>
public class User
{
    public string? Name { get; }

    public User(string? name)
    {
        Name = name;
    }
}
