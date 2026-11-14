namespace Fixture.Models;

/// <summary>
/// Repository port. Calls through this interface are the "hard" relations of the
/// ground truth: a static rule pack can point at the port, never prove the impl.
/// </summary>
public interface IRepository
{
    User? Find(int id);

    void Log(long id);
}
