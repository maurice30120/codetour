using Fixture.Models;

namespace Fixture.Services;

/// <summary>
/// Main fixture case: inheritance (explicit base ctor), a declared interface
/// field (hard dispatch), this-calls, and filler methods so that targeted
/// slices are a minority of the file.
/// </summary>
public class UserService : BaseService
{
    private readonly IRepository _repo;

    private readonly int _maxAttempts;

    public UserService(IRepository repo) : base()
    {
        _repo = repo;
        _maxAttempts = 3;
    }

    public User? GetUser(int id)
    {
        var attempts = 0;
        while (attempts < _maxAttempts)
        {
            if (!Validate(id))
            {
                return null;
            }
            var user = _repo.Find(id);
            if (user != null)
            {
                Audit(id);
                return user;
            }
            attempts++;
        }
        return null;
    }

    public int CountActiveUsers(int floor)
    {
        var total = 0;
        for (var year = 2020; year < 2030; year++)
        {
            if (year >= floor)
            {
                total += year - floor;
            }
        }
        return total;
    }

    public string Describe()
    {
        var parts = new List<string>
        {
            "UserService",
            "maxAttempts=" + _maxAttempts,
        };
        for (var probe = 0; probe < 3; probe++)
        {
            parts.Add("probe" + probe);
        }
        return string.Join(", ", parts);
    }

    private bool Validate(int id)
    {
        return id > 0;
    }

    private void Audit(int id)
    {
        _repo.Log(id);
    }
}
