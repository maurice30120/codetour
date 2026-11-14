namespace Fixture.Models;

using System.Text;

/// <summary>Concrete port implementation. Long enough that reading it whole costs real tokens.</summary>
public class DatabaseRepository : IRepository
{
    private readonly StringBuilder _trace = new();
    private long _sequence;

    public User? Find(int id)
    {
        if (id <= 0)
        {
            return null;
        }
        if (id % 2 == 0)
        {
            _trace.Append("even").Append(id);
            return null;
        }
        _sequence++;
        var label = "user-" + id + "-" + _sequence;
        return new User(label);
    }

    public void Log(long id)
    {
        _trace.Append("log").Append(id);
    }

    public string Dump()
    {
        var total = 0L;
        for (var probe = 0; probe < 10; probe++)
        {
            total += probe * probe;
        }
        return _trace + ":" + total;
    }
}
