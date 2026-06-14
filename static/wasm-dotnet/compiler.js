import { loadDotnetCompilerRuntime, } from "./runtime-loader.js";
const referenceAssemblyCache = new Map();
function normalizeSource(request) {
    return request.source ?? request.code ?? "";
}
function normalizeLanguage(language) {
    return language || "fsharp";
}
function languageLabel(language) {
    return language === "csharp"
        ? "C#"
        : language === "vbnet"
            ? "VB.NET"
            : "F#";
}
function emitProgress(request, stage, completed, total, message) {
    request.onProgress?.({
        stage,
        completed,
        total,
        percent: total <= 0 ? 100 : Math.min(100, Math.max(0, (completed / total) * 100)),
        ...(message ? { message } : {}),
    });
}
export function parseDotnetDiagnostics(text = "") {
    const diagnostics = [];
    const pattern = /(?:(?<file>[^\r\n()]+)\((?<line>\d+),(?<column>\d+)\):\s*)?(?<severity>error|warning)\s+(?<code>[A-Z]+\d+):\s*(?<message>[^\r\n]+)/gi;
    for (const match of text.matchAll(pattern)) {
        const groups = match.groups || {};
        diagnostics.push({
            fileName: groups.file?.trim() || "Program.fs",
            lineNumber: groups.line ? Number(groups.line) : 1,
            columnNumber: groups.column ? Number(groups.column) : 1,
            severity: groups.severity?.toLowerCase() === "warning"
                ? "warning"
                : groups.severity?.toLowerCase() === "error"
                    ? "error"
                    : "other",
            message: `${groups.code ? `${groups.code}: ` : ""}${groups.message || match[0]}`.trim(),
        });
    }
    return diagnostics;
}
function failure(message, stderr) {
    const diagnostics = parseDotnetDiagnostics(stderr || message);
    return {
        success: false,
        stderr: stderr || message,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
}
function resolveReferenceBaseUrl(options) {
    const runtimeBaseUrl = new URL(options.runtimeBaseUrl || "./runtime/", import.meta.url);
    return new URL(options.referenceBaseUrl || "ref/", runtimeBaseUrl);
}
function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
function isUserReferenceAssembly(name, language) {
    if (name === "FSharp.Compiler.Service.dll" ||
        name === "Microsoft.CodeAnalysis.dll" ||
        name === "Microsoft.CodeAnalysis.CSharp.dll" ||
        name === "Microsoft.CodeAnalysis.VisualBasic.dll") {
        return false;
    }
    if (language === "csharp" && name === "FSharp.Core.dll") {
        return false;
    }
    if (language === "vbnet" && name === "FSharp.Core.dll") {
        return false;
    }
    return name.endsWith(".dll");
}
async function loadDotnetReferenceAssemblies(options = {}, language) {
    const baseUrl = resolveReferenceBaseUrl(options);
    const cacheKey = `${baseUrl.toString()}\n${language}`;
    const cached = referenceAssemblyCache.get(cacheKey);
    if (cached)
        return await cached;
    const promise = (async () => {
        const manifestResponse = await fetch(new URL("manifest.json", baseUrl));
        if (!manifestResponse.ok) {
            throw new Error(`Failed to load .NET reference assembly manifest: ${manifestResponse.status} ${manifestResponse.statusText}`);
        }
        const manifest = (await manifestResponse.json());
        const assemblies = (manifest.assemblies || []).filter((name) => isUserReferenceAssembly(name, language));
        return await Promise.all(assemblies.map(async (name) => {
            const response = await fetch(new URL(name, baseUrl));
            if (!response.ok) {
                throw new Error(`Failed to load .NET reference assembly ${name}: ${response.status} ${response.statusText}`);
            }
            return {
                name,
                bytesBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
            };
        }));
    })();
    referenceAssemblyCache.set(cacheKey, promise);
    return await promise;
}
export async function compileDotnet(request, dependencies = {}) {
    const source = normalizeSource(request);
    if (!source.trim()) {
        return failure(".NET compilation requires a non-empty source string.");
    }
    const language = normalizeLanguage(request.language);
    if (language !== "fsharp" && language !== "csharp" && language !== "vbnet") {
        return failure(`Unsupported .NET language: ${language}`);
    }
    const target = request.target || "browser-wasm";
    if (target !== "browser-wasm") {
        return failure(`Unsupported .NET target: ${target}`);
    }
    emitProgress(request, "runtime", 1, 10, "loading .NET browser compiler runtime");
    try {
        const runtime = await (dependencies.loadRuntime || loadDotnetCompilerRuntime)();
        const references = dependencies.loadReferences
            ? await dependencies.loadReferences(language)
            : [];
        emitProgress(request, "compile", 5, 10, `compiling ${languageLabel(language)} source`);
        const payload = await runtime.compile({
            source,
            language,
            target,
            args: request.args || [],
            ...(references.length > 0 ? { references } : {}),
        });
        emitProgress(request, "done", 1, 1);
        const diagnostics = payload.diagnostics ||
            parseDotnetDiagnostics(payload.stderr || payload.error || "");
        return {
            success: payload.success !== false && !!payload.assemblyId,
            artifact: payload.assemblyId
                ? {
                    format: "dotnet-browser-assembly",
                    assemblyId: payload.assemblyId,
                    language,
                    target,
                }
                : undefined,
            stdout: payload.stdout,
            stderr: payload.stderr || payload.error,
            ...(diagnostics.length > 0 ? { diagnostics } : {}),
            logs: payload.logs,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(message, message);
    }
}
export function createDotnetCompiler(options = {}) {
    return {
        async compile(request) {
            return await compileDotnet(request, {
                loadRuntime: () => loadDotnetCompilerRuntime(options),
                loadReferences: options.dotnetModule
                    ? async () => []
                    : (language) => loadDotnetReferenceAssemblies(options, language),
            });
        },
    };
}
//# sourceMappingURL=compiler.js.map