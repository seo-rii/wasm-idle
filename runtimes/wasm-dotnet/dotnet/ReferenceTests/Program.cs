using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Text.Json;
using System.Threading.Tasks;
using WasmDotnet.Compiler;
internal static class ReferenceTests
{
    static int assertions;
    static void Check(bool value, string message) { if (!value) throw new Exception(message); assertions++; }
    static void Reject(Action action) { try { action(); } catch { assertions++; return; } throw new Exception("Expected rejection"); }
    static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;
    static async Task Main(string[] args)
    {
        var registry = new ReferenceSetRegistry<byte[]>(2, 100);
        var token = registry.Register([("a.dll", "AQI=")], entries => entries[0].Bytes);
        Check(registry.Get(token).SequenceEqual(new byte[]{1,2}), "Decoded bytes");
        Reject(()=>registry.Get("unknown"));
        foreach(var name in new[]{"../x.dll","a/b.dll","a\\b.dll","C:x.dll","x", ""})
            Reject(()=>registry.Register([(name,"AQI=")], e=>e[0].Bytes));
        Reject(()=>registry.Register([("x.dll","AQI="),("X.dll","AQI=")], e=>e[0].Bytes));
        Reject(()=>registry.Register([("x.dll","broken")], e=>e[0].Bytes));
        Reject(()=>registry.Register([("x.dll","AQI=")], e=>throw new Exception("materialization failed")));
        var second=registry.Register([("b.dll","AwQ=")], e=>e[0].Bytes);
        Check(registry.Get(second)[0]==3,"Failed registrations did not consume capacity");
        Reject(()=>registry.Register([("c.dll","AQI=")], e=>e[0].Bytes));
        var bounded = new ReferenceSetRegistry<byte[]>(3,2);
        Reject(()=>bounded.Register([("a.dll","AQI=")], e=>e[0].Bytes));
        // Use the actual framework reference pack, not fabricated assemblies.
        var references=Directory.GetFiles(args[0],"*.dll").Select(p=>new {name=Path.GetFileName(p), bytesBase64=Convert.ToBase64String(File.ReadAllBytes(p))}).ToList();
#if WASM_DOTNET_FSHARP
        references.Add(new {name="FSharp.Core.dll",bytesBase64=Convert.ToBase64String(File.ReadAllBytes(typeof(Microsoft.FSharp.Core.Unit).Assembly.Location))});
        const string language="fsharp";
        const string source="open System\n[<EntryPoint>]\nlet main argv =\n    printfn \"%s!\" (Console.ReadLine())\n    0";
        const string debugSource="open System\n[<EntryPoint>]\nlet main argv =\n    let value = Int32.Parse(Console.ReadLine())\n    printfn \"%d\" (value + 5)\n    0";
        const string sourcePath="/workspace/nested/DebugProgram.fs";
#elif WASM_DOTNET_VBNET
        const string language="vbnet";
        const string source="Imports System\nModule Main\nSub Main()\nConsole.WriteLine(Console.ReadLine() & \"!\")\nEnd Sub\nEnd Module";
        const string debugSource="Imports System\nModule Main\nSub Main()\nDim value As Integer = Integer.Parse(Console.ReadLine())\nConsole.WriteLine(value + 5)\nEnd Sub\nEnd Module";
        const string sourcePath="/workspace/nested/DebugProgram.vb";
#else
        const string language="csharp";
        const string source="using System; class MainClass { public static void Main() { Console.WriteLine(Console.ReadLine() + \"!\"); }}";
        const string debugSource="using System;\nclass MainClass {\npublic static void Main() {\nint value = Int32.Parse(Console.ReadLine());\nConsole.WriteLine(value + 5);\n}}";
        const string sourcePath="/workspace/nested/DebugProgram.cs";
#endif
        var registered=Parse(CompilerHost.RegisterReferences(JsonSerializer.Serialize(new {references})));
        Check(!registered.TryGetProperty("error",out _),registered.ToString());
        var id=registered.GetProperty("referenceSetId").GetString();
        for(var i=0;i<2;i++)
        {
            var compile=Parse(await CompilerHost.Compile(JsonSerializer.Serialize(new {source,language,referenceSetId=id})));
            Check(compile.GetProperty("success").GetBoolean(),compile.ToString());
            var run=Parse(await CompilerHost.Run(JsonSerializer.Serialize(new {assemblyId=compile.GetProperty("assemblyId").GetString(),stdin="registered",args=Array.Empty<string>()})));
            Check(run.GetProperty("exitCode").GetInt32()==0,run.ToString());
            Check(run.GetProperty("stdout").GetString()?.Replace("\r\n","\n")=="registered!\n",run.ToString());
        }
        var invalid=Parse(await CompilerHost.Compile(JsonSerializer.Serialize(new {source,language,referenceSetId="unknown"})));
        Check(!invalid.GetProperty("success").GetBoolean(),"Unknown ID must fail closed");
        var both=Parse(await CompilerHost.Compile(JsonSerializer.Serialize(new {source,language,referenceSetId=id,references})));
        Check(!both.GetProperty("success").GetBoolean(),"Ambiguous payload must fail");
        var debugCompile=Parse(await CompilerHost.Compile(JsonSerializer.Serialize(new {source=debugSource,language,referenceSetId=id,debug=true,sourcePath})));
        Check(debugCompile.GetProperty("success").GetBoolean(),debugCompile.ToString());
        var debug=debugCompile.GetProperty("debug");
        Check(debug.GetProperty("format").GetString()=="portable-pdb",debug.ToString());
        Check(debug.GetProperty("sourcePath").GetString()==sourcePath,"Source path must survive compilation");
        using(var symbols = new MemoryStream(Convert.FromBase64String(debug.GetProperty("symbolsBytesBase64").GetString()!)))
        using(var provider = MetadataReaderProvider.FromPortablePdbStream(symbols))
        {
            var metadata=provider.GetMetadataReader();
            Check(metadata.Documents.Select(handle=>metadata.GetString(metadata.GetDocument(handle).Name)).Contains(sourcePath),"PDB must use the editor source path");
            Check(metadata.MethodDebugInformation.Any(handle=>metadata.GetMethodDebugInformation(handle).GetSequencePoints().Any(point=>!point.IsHidden && point.StartLine>=4)),"PDB must contain real source sequence points");
            Check(metadata.LocalVariables.Select(handle=>metadata.GetString(metadata.GetLocalVariable(handle).Name)).Contains("value"),"PDB must contain the user's local variable");
        }
        var debugRun=Parse(await CompilerHost.Run(JsonSerializer.Serialize(new {assemblyId=debugCompile.GetProperty("assemblyId").GetString(),stdin="7",args=Array.Empty<string>()})));
        Check(debugRun.GetProperty("exitCode").GetInt32()==0,debugRun.ToString());
        Check(debugRun.GetProperty("stdout").GetString()?.Replace("\r\n","\n")=="12\n",debugRun.ToString());
        var invalidPath=Parse(await CompilerHost.Compile(JsonSerializer.Serialize(new {source,language,referenceSetId=id,debug=true,sourcePath="/workspace/../outside.cs"})));
        Check(!invalidPath.GetProperty("success").GetBoolean(),"Traversal source paths must be rejected");
        Console.WriteLine($"{language}: {assertions} assertions passed with actual compiler and stdin/stdout");
    }
}
