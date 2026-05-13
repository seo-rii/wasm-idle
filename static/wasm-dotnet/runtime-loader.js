let runtimePromise = null;
let runtimeKey = "";
function resolveRuntimeBaseUrl(options) {
    return new URL(options.runtimeBaseUrl || "./runtime/", import.meta.url);
}
function resolveDotnetJsUrl(options) {
    if (options.dotnetJsUrl) {
        return new URL(options.dotnetJsUrl, globalThis.location?.href || import.meta.url).toString();
    }
    return new URL("dotnet.js", resolveRuntimeBaseUrl(options)).toString();
}
function getDotnetBuilder(module) {
    const record = module;
    const dotnet = record?.dotnet ||
        record?.default?.dotnet;
    if (!dotnet || typeof dotnet.create !== "function") {
        throw new Error("wasm-dotnet expected a dotnet.js module exporting dotnet.create().");
    }
    return dotnet;
}
function readPath(root, path) {
    let current = root;
    for (const part of path) {
        if (!current || typeof current !== "object")
            return undefined;
        current = current[part];
    }
    return current;
}
function findBridge(exports) {
    const candidates = [
        readPath(exports, ["WasmDotnet", "Compiler", "CompilerHost"]),
        readPath(exports, ["WasmDotnet.Compiler", "CompilerHost"]),
        readPath(exports, ["CompilerHost"]),
        exports,
    ];
    for (const candidate of candidates) {
        const bridge = candidate;
        if (bridge &&
            (typeof bridge.Compile === "function" ||
                typeof bridge.compile === "function") &&
            (typeof bridge.Run === "function" || typeof bridge.run === "function")) {
            return bridge;
        }
    }
    throw new Error("wasm-dotnet runtime did not export CompilerHost.Compile and CompilerHost.Run.");
}
async function callJson(method, payload) {
    const response = await method(JSON.stringify(payload));
    return JSON.parse(response);
}
export function resetDotnetCompilerRuntimeForTests() {
    runtimePromise = null;
    runtimeKey = "";
}
export async function loadDotnetCompilerRuntime(options = {}) {
    const dotnetJsUrl = resolveDotnetJsUrl(options);
    const key = `${dotnetJsUrl}\n${options.mainAssemblyName || ""}\n${options.dotnetModule ? "injected" : ""}`;
    if (runtimePromise && runtimeKey === key)
        return await runtimePromise;
    runtimeKey = key;
    runtimePromise = (async () => {
        const dotnetModule = options.dotnetModule || (await import(/* @vite-ignore */ dotnetJsUrl));
        let builder = getDotnetBuilder(dotnetModule);
        if (builder.withDiagnosticTracing) {
            builder = builder.withDiagnosticTracing(false);
        }
        const runtime = await builder.create();
        if (typeof runtime.getAssemblyExports !== "function") {
            throw new Error("wasm-dotnet runtime did not expose getAssemblyExports().");
        }
        const assemblyName = options.mainAssemblyName ||
            runtime.getConfig?.().mainAssemblyName ||
            "WasmDotnet.Compiler.dll";
        const exports = await runtime.getAssemblyExports(assemblyName);
        const bridge = findBridge(exports);
        const compile = bridge.Compile || bridge.compile;
        const run = bridge.Run || bridge.run;
        if (!compile || !run) {
            throw new Error("wasm-dotnet compiler bridge is incomplete.");
        }
        return {
            compile(request) {
                return callJson(compile.bind(bridge), request);
            },
            run(request) {
                return callJson(run.bind(bridge), request);
            },
        };
    })();
    return await runtimePromise;
}
//# sourceMappingURL=runtime-loader.js.map