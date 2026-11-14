using Fixture.Models;

namespace Fixture.Services;

/// <summary>
/// Homonym fixture: declares GetUser like UserService, different semantics.
/// The caller resolves it through a using-alias, which is the C# twist the
/// rule pack must survive.
/// </summary>
public class AdminService : BaseService
{
    private readonly IRepository _repo;

    public AdminService(IRepository repo) : base()
    {
        _repo = repo;
    }

    public User? GetUser(int id)
    {
        if (id < 1000)
        {
            var user = _repo.Find(id);
            _repo.Log(id);
            return user;
        }
        return null;
    }
}
