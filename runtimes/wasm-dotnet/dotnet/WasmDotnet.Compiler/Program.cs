using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.VisualBasic;
using CSharpSyntaxFactory = Microsoft.CodeAnalysis.CSharp.SyntaxFactory;
using FSharp.Compiler.CodeAnalysis;
using FSharp.Compiler.Diagnostics;
using Microsoft.FSharp.Control;
using Microsoft.FSharp.Core;

namespace WasmDotnet.Compiler;

public static partial class CompilerHost
{
    private static readonly Dictionary<string, Assembly> Assemblies = new();

    static CompilerHost()
    {
        AppDomain.CurrentDomain.AssemblyResolve += ResolveLoadedAssembly;
    }

    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties, typeof(StdinShim))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties, typeof(Console))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties, typeof(Environment))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties, typeof(int))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods | DynamicallyAccessedMemberTypes.PublicProperties, typeof(string))]
    public static void Main()
    {
    }

    [JSExport]
    public static async Task<string> Compile(string requestJson)
    {
        try
        {
            var request = JsonSerializer.Deserialize(requestJson, CompilerJsonContext.Default.CompileRequest)
                ?? new CompileRequest();
            if (string.IsNullOrWhiteSpace(request.Source))
            {
                return WriteJson(new CompileResponse
                {
                    Success = false,
                    Error = ".NET compilation requires a non-empty source string."
                });
            }

            var result = request.Language switch
            {
                "csharp" => CompileCSharp(request.Source, request.References),
                "vbnet" => CompileVisualBasic(request.Source, request.References),
                _ => await CompileFSharp(request.Source, request.References)
            };

            if (!result.Success || result.Assembly is null)
            {
                return WriteJson(new CompileResponse
                {
                    Success = false,
                    Diagnostics = result.Diagnostics,
                    Stderr = result.Stderr
                });
            }

            var assemblyId = Guid.NewGuid().ToString("N");
            Assemblies[assemblyId] = result.Assembly;
            return WriteJson(new CompileResponse
            {
                Success = true,
                AssemblyId = assemblyId,
                Diagnostics = result.Diagnostics,
                Logs = result.Logs
            });
        }
        catch (Exception error)
        {
            return WriteJson(new CompileResponse
            {
                Success = false,
                Error = error.ToString()
            });
        }
    }

    [JSExport]
    public static Task<string> Run(string requestJson)
    {
        var previousOut = Console.Out;
        var previousError = Console.Error;
        try
        {
            var request = JsonSerializer.Deserialize(requestJson, CompilerJsonContext.Default.RunRequest)
                ?? new RunRequest();
            if (request.AssemblyId is null || !Assemblies.TryGetValue(request.AssemblyId, out var assembly))
            {
                return Task.FromResult(WriteJson(new RunResponse
                {
                    ExitCode = 1,
                    Error = $"Compiled assembly was not found: {request.AssemblyId}"
                }));
            }

            using var stdout = new StringWriter();
            using var stderr = new StringWriter();
            StdinShim.Set(request.Stdin);
            Console.SetOut(stdout);
            Console.SetError(stderr);
            var entryPoint = assembly.EntryPoint;
            if (entryPoint is null)
            {
                return Task.FromResult(WriteJson(new RunResponse
                {
                    ExitCode = 1,
                    Stderr = "Compiled assembly does not have an entry point."
                }));
            }

            var args = request.Args ?? [];
            var parameters = entryPoint.GetParameters().Length == 0
                ? null
                : new object?[] { args };
            var result = entryPoint.Invoke(null, parameters);
            if (result is Task task)
            {
                task.GetAwaiter().GetResult();
            }

            return Task.FromResult(WriteJson(new RunResponse
            {
                ExitCode = 0,
                Stdout = stdout.ToString(),
                Stderr = stderr.ToString()
            }));
        }
        catch (TargetInvocationException error)
        {
            return Task.FromResult(WriteJson(new RunResponse
            {
                ExitCode = 1,
                Error = error.InnerException?.ToString() ?? error.ToString()
            }));
        }
        catch (Exception error)
        {
            return Task.FromResult(WriteJson(new RunResponse
            {
                ExitCode = 1,
                Error = error.ToString()
            }));
        }
        finally
        {
            StdinShim.Set(null);
            Console.SetOut(previousOut);
            Console.SetError(previousError);
        }
    }

    private static CompileResult CompileCSharp(string source, ReferenceAssembly[]? references)
    {
        using var stream = new MemoryStream();
        var syntaxTree = CSharpSyntaxTree.ParseText(RewriteCSharpSource(source));
        var compilation = CSharpCompilation.Create(
            $"WasmIdleCSharp_{Guid.NewGuid():N}",
            [syntaxTree],
            MetadataReferences(references),
            new CSharpCompilationOptions(OutputKind.ConsoleApplication)
                .WithConcurrentBuild(false));
        var emit = compilation.Emit(stream);
        var diagnostics = emit.Diagnostics.Select(ToDiagnostic).ToArray();
        if (!emit.Success)
        {
            return new CompileResult
            {
                Success = false,
                Diagnostics = diagnostics,
                Stderr = string.Join("\n", diagnostics.Select(d => d.Message))
            };
        }

        stream.Position = 0;
        return new CompileResult
        {
            Success = true,
            Assembly = Assembly.Load(stream.ToArray()),
            Diagnostics = diagnostics
        };
    }

    private static CompileResult CompileVisualBasic(string source, ReferenceAssembly[]? references)
    {
        using var stream = new MemoryStream();
        var syntaxTree = VisualBasicSyntaxTree.ParseText(RewriteVisualBasicSource(source));
        var compilation = VisualBasicCompilation.Create(
            $"WasmIdleVisualBasic_{Guid.NewGuid():N}",
            [syntaxTree],
            MetadataReferences(references),
            new VisualBasicCompilationOptions(OutputKind.ConsoleApplication)
                .WithConcurrentBuild(false)
                .WithOptionStrict(OptionStrict.Off)
                .WithOptionInfer(true)
                .WithOptionExplicit(true));
        var emit = compilation.Emit(stream);
        var diagnostics = emit.Diagnostics.Select(ToDiagnostic).ToArray();
        if (!emit.Success)
        {
            return new CompileResult
            {
                Success = false,
                Diagnostics = diagnostics,
                Stderr = string.Join("\n", diagnostics.Select(d => d.Message))
            };
        }

        stream.Position = 0;
        return new CompileResult
        {
            Success = true,
            Assembly = Assembly.Load(stream.ToArray()),
            Diagnostics = diagnostics
        };
    }

    private static async Task<CompileResult> CompileFSharp(string source, ReferenceAssembly[]? references)
    {
        var workDir = Path.Combine(Path.GetTempPath(), $"wasm-dotnet-{Guid.NewGuid():N}");
        Directory.CreateDirectory(workDir);
        var sourcePath = Path.Combine(workDir, "Program.fs");
        var outputPath = Path.Combine(workDir, "Program.dll");
        File.WriteAllText(sourcePath, RewriteFSharpSource(source));
        var argv = new List<string>
        {
            "fsc.exe",
            "--target:exe",
            "--targetprofile:netcore",
            "--noframework",
            "--simpleresolution",
            "--nowin32manifest",
            "--debug-",
            "--optimize-",
            $"--out:{outputPath}",
            sourcePath
        };
        argv.AddRange(ReferenceAssemblyPaths(workDir, references).Select(path => $"-r:{path}"));

        var disabled = Some(false);
        var checker = FSharpChecker.Create(
            null,
            disabled,
            disabled,
            null,
            null,
            disabled,
            disabled,
            disabled,
            disabled,
            disabled,
            disabled,
            null,
            disabled,
            null);
        var result = await FSharpAsync.StartAsTask(checker.Compile(argv.ToArray(), null), null, null);
        var diagnostics = new CompilerDiagnostic[result.Item1.Length];
        for (var index = 0; index < result.Item1.Length; index++)
        {
            diagnostics[index] = ToDiagnostic(result.Item1[index]);
        }
        if (result.Item2 is not null || !File.Exists(outputPath))
        {
            return new CompileResult
            {
                Success = false,
                Diagnostics = diagnostics,
                Stderr = string.Join("\n", diagnostics.Select(d => d.Message))
            };
        }

        return new CompileResult
        {
            Success = true,
            Assembly = Assembly.Load(File.ReadAllBytes(outputPath)),
            Diagnostics = diagnostics
        };
    }

    private static IEnumerable<MetadataReference> MetadataReferences(ReferenceAssembly[]? references)
    {
        IEnumerable<MetadataReference> metadataReferences;
        if (references is { Length: > 0 })
        {
            metadataReferences = references.Select(reference =>
                MetadataReference.CreateFromImage(Convert.FromBase64String(reference.BytesBase64 ?? "")));
        }
        else
        {
            metadataReferences = TrustedPlatformReferencePaths().Select(path => MetadataReference.CreateFromFile(path));
        }

        var hostAssemblyPath = HostAssemblyReferencePath();
        if (!string.IsNullOrWhiteSpace(hostAssemblyPath))
        {
            metadataReferences = metadataReferences.Concat([MetadataReference.CreateFromFile(hostAssemblyPath)]);
        }
        return metadataReferences;
    }

    private static string[] ReferenceAssemblyPaths(string workDir, ReferenceAssembly[]? references)
    {
        string[] paths;
        if (references is not { Length: > 0 })
        {
            paths = TrustedPlatformReferencePaths();
        }
        else
        {
            var referenceDir = Path.Combine(workDir, "ref");
            Directory.CreateDirectory(referenceDir);
            paths = references.Select(reference =>
            {
                var fileName = Path.GetFileName(reference.Name);
                if (string.IsNullOrWhiteSpace(fileName))
                {
                    fileName = $"{Guid.NewGuid():N}.dll";
                }
                var path = Path.Combine(referenceDir, fileName);
                File.WriteAllBytes(path, Convert.FromBase64String(reference.BytesBase64 ?? ""));
                return path;
            }).ToArray();
        }

        var hostAssemblyPath = HostAssemblyReferencePath();
        if (!string.IsNullOrWhiteSpace(hostAssemblyPath) && !paths.Contains(hostAssemblyPath))
        {
            paths = paths.Append(hostAssemblyPath).ToArray();
        }
        return paths;
    }

    private static string? HostAssemblyReferencePath()
    {
        var path = AssemblyLocation(typeof(CompilerHost).Assembly);
        return !string.IsNullOrWhiteSpace(path) && File.Exists(path) ? path : null;
    }

    private static string[] TrustedPlatformReferencePaths()
    {
        var raw = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string;
        var paths = string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        if (paths.Length > 0)
        {
            return paths;
        }

        return AppDomain.CurrentDomain.GetAssemblies()
            .Select(AssemblyLocation)
            .Where(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static Assembly? ResolveLoadedAssembly(object? sender, ResolveEventArgs args)
    {
        var requestedName = new AssemblyName(args.Name).Name;
        var loaded = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(assembly => assembly.GetName().Name == requestedName);
        if (loaded is not null)
        {
            return loaded;
        }

        return requestedName is "System.Runtime" or "netstandard"
            ? typeof(object).Assembly
            : null;
    }

    private static FSharpOption<T> Some<T>(T value) => FSharpOption<T>.Some(value);

    private static string AssemblyLocation(Assembly assembly)
    {
        try
        {
            return assembly.Location;
        }
        catch
        {
            return "";
        }
    }

    private static string RewriteCSharpSource(string source)
    {
        var root = CSharpSyntaxTree.ParseText(source).GetRoot();
        return new CSharpStdinRewriter().Visit(root)?.ToFullString() ?? source;
    }

    private static string RewriteFSharpSource(string source) =>
        source
            .Replace("System.Console.ReadLine(", "WasmDotnet.Compiler.StdinShim.ReadLine(")
            .Replace("Console.ReadLine(", "WasmDotnet.Compiler.StdinShim.ReadLine(")
            .Replace("System.Console.In", "WasmDotnet.Compiler.StdinShim.In")
            .Replace("Console.In", "WasmDotnet.Compiler.StdinShim.In");

    private static string RewriteVisualBasicSource(string source) =>
        source
            .Replace("System.Console.ReadLine(", "WasmDotnet.Compiler.StdinShim.ReadLine(")
            .Replace("Console.ReadLine(", "WasmDotnet.Compiler.StdinShim.ReadLine(")
            .Replace("System.Console.In", "WasmDotnet.Compiler.StdinShim.In")
            .Replace("Console.In", "WasmDotnet.Compiler.StdinShim.In");

    private sealed class CSharpStdinRewriter : CSharpSyntaxRewriter
    {
        public override SyntaxNode? VisitInvocationExpression(InvocationExpressionSyntax node)
        {
            if (
                node.Expression is MemberAccessExpressionSyntax memberAccess &&
                memberAccess.Name.Identifier.ValueText == "ReadLine" &&
                IsConsoleExpression(memberAccess.Expression)
            )
            {
                return node.WithExpression(
                    CSharpSyntaxFactory.ParseExpression("WasmDotnet.Compiler.StdinShim.ReadLine"));
            }

            return base.VisitInvocationExpression(node);
        }

        public override SyntaxNode? VisitMemberAccessExpression(MemberAccessExpressionSyntax node)
        {
            if (node.Name.Identifier.ValueText == "In" && IsConsoleExpression(node.Expression))
            {
                return CSharpSyntaxFactory.ParseExpression("WasmDotnet.Compiler.StdinShim.In");
            }

            return base.VisitMemberAccessExpression(node);
        }

        private static bool IsConsoleExpression(ExpressionSyntax expression)
        {
            var text = expression.ToString();
            return text == "Console" || text == "System.Console";
        }
    }

    private static CompilerDiagnostic ToDiagnostic(Diagnostic diagnostic)
    {
        var span = diagnostic.Location.GetLineSpan();
        return new CompilerDiagnostic
        {
            FileName = span.Path,
            LineNumber = span.StartLinePosition.Line + 1,
            ColumnNumber = span.StartLinePosition.Character + 1,
            Severity = diagnostic.Severity == DiagnosticSeverity.Warning
                ? "warning"
                : diagnostic.Severity == DiagnosticSeverity.Error
                    ? "error"
                    : "other",
            Message = $"{diagnostic.Id}: {diagnostic.GetMessage()}"
        };
    }

    private static CompilerDiagnostic ToDiagnostic(FSharpDiagnostic diagnostic) =>
        new()
        {
            FileName = diagnostic.FileName,
            LineNumber = diagnostic.StartLine,
            ColumnNumber = diagnostic.StartColumn,
            EndColumnNumber = diagnostic.EndColumn,
            Severity = diagnostic.Severity == FSharpDiagnosticSeverity.Warning
                ? "warning"
                : diagnostic.Severity == FSharpDiagnosticSeverity.Error
                    ? "error"
                    : "other",
            Message = $"{diagnostic.ErrorNumberPrefix}{diagnostic.ErrorNumber}: {diagnostic.Message}"
        };

    private static string WriteJson(CompileResponse value) =>
        JsonSerializer.Serialize(value, CompilerJsonContext.Default.CompileResponse);

    private static string WriteJson(RunResponse value) =>
        JsonSerializer.Serialize(value, CompilerJsonContext.Default.RunResponse);

    public sealed class CompileRequest
    {
        public string? Source { get; set; }
        public string? Language { get; set; }
        public string[]? Args { get; set; }
        public ReferenceAssembly[]? References { get; set; }
    }

    public sealed class ReferenceAssembly
    {
        public string Name { get; set; } = "";
        public string? BytesBase64 { get; set; }
    }

    public sealed class RunRequest
    {
        public string? AssemblyId { get; set; }
        public string[]? Args { get; set; }
        public string? Stdin { get; set; }
    }

    private sealed class CompileResult
    {
        public bool Success { get; set; }
        public Assembly? Assembly { get; set; }
        public CompilerDiagnostic[]? Diagnostics { get; set; }
        public string? Stderr { get; set; }
        public string[]? Logs { get; set; }
    }

    public sealed class CompileResponse
    {
        public bool Success { get; set; }
        public string? AssemblyId { get; set; }
        public string? Stdout { get; set; }
        public string? Stderr { get; set; }
        public CompilerDiagnostic[]? Diagnostics { get; set; }
        public string[]? Logs { get; set; }
        public string? Error { get; set; }
    }

    public sealed class RunResponse
    {
        public int? ExitCode { get; set; }
        public string? Stdout { get; set; }
        public string? Stderr { get; set; }
        public string? Error { get; set; }
    }

    public sealed class CompilerDiagnostic
    {
        public string? FileName { get; set; }
        public int LineNumber { get; set; }
        public int? ColumnNumber { get; set; }
        public int? EndColumnNumber { get; set; }
        public string Severity { get; set; } = "other";
        public string Message { get; set; } = "";
    }
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(CompilerHost.CompileRequest))]
[JsonSerializable(typeof(CompilerHost.CompileResponse))]
[JsonSerializable(typeof(CompilerHost.ReferenceAssembly))]
[JsonSerializable(typeof(CompilerHost.RunRequest))]
[JsonSerializable(typeof(CompilerHost.RunResponse))]
internal sealed partial class CompilerJsonContext : JsonSerializerContext
{
}

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
