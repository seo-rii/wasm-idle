using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace WasmDotnet.Compiler;

// Registration is bounded and atomic. Never evict a set behind an in-flight compile.
internal sealed class ReferenceSetRegistry<T> where T : class
{
    private readonly object gate = new();
    private readonly Dictionary<string, T> sets = new(StringComparer.Ordinal);
    private long retainedBytes;
    private readonly int maxSets;
    private readonly long maxBytes;
    public ReferenceSetRegistry(int maxSets = 8, long maxBytes = 128L * 1024 * 1024)
    {
        if (maxSets <= 0 || maxBytes <= 0) throw new ArgumentOutOfRangeException();
        this.maxSets = maxSets; this.maxBytes = maxBytes;
    }
    public string Register((string Name, string Base64)[] references, Func<(string Name, byte[] Bytes)[], T> create)
    {
        if (references.Length == 0 || references.Length > 512) throw new InvalidDataException("Invalid reference count.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long estimatedBytes = 0;
        foreach (var (name, data) in references)
        {
            if (string.IsNullOrWhiteSpace(name) || name.Length > 255 || name.IndexOfAny(['/', '\\', ':', '\0']) >= 0 ||
                !name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) || !names.Add(name))
                throw new InvalidDataException("Invalid or duplicate reference assembly name.");
            if (data is null || data.Length == 0 || data.Length > 48 * 1024 * 1024)
                throw new InvalidDataException("Reference assembly exceeds its byte budget.");
            estimatedBytes += ((long)data.Length + 3) / 4 * 3;
            if (estimatedBytes > 64L * 1024 * 1024) throw new InvalidDataException("Reference set exceeds its byte budget.");
        }
        lock (gate)
        {
            if (sets.Count >= maxSets || retainedBytes + estimatedBytes > maxBytes)
                throw new InvalidOperationException("Reference registry is full; restart the compiler runtime.");
            var decoded = references.Select(r => (r.Name, Convert.FromBase64String(r.Base64))).ToArray();
            var value = create(decoded); // Validation/materialization failures do not publish a token.
            var id = Guid.NewGuid().ToString("N");
            sets.Add(id, value);
            retainedBytes += estimatedBytes;
            return id;
        }
    }
    public T Get(string id)
    {
        lock (gate) return sets.TryGetValue(id, out var value) ? value :
            throw new InvalidOperationException("Unknown reference-set ID for this compiler runtime.");
    }
}
