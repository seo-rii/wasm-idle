using System.IO;

namespace WasmDotnet.Compiler;

public static class StdinShim
{
    private static StringReader? reader;

    public static TextReader In => reader ?? TextReader.Null;

    public static void Set(string? input)
    {
        reader?.Dispose();
        reader = input is null ? null : new StringReader(input);
    }

    public static string? ReadLine() => reader?.ReadLine();
}
