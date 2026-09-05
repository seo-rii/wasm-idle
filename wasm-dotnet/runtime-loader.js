const runtimePromises = new Map();
export function resolveDotnetRuntimeBaseUrl(options = {}) {
    if (options.runtimeBaseUrl) {
        return new URL(options.runtimeBaseUrl, globalThis.location?.href || import.meta.url);
    }
    return new URL(`./runtime/${options.language || 'fsharp'}/`, import.meta.url);
}
function resolveDotnetJsUrl(options) {
    if (options.dotnetJsUrl) {
        return new URL(options.dotnetJsUrl, globalThis.location?.href || import.meta.url).toString();
    }
    return new URL('dotnet.js', resolveDotnetRuntimeBaseUrl(options)).toString();
}
function getDotnetBuilder(module) {
    const record = module;
    const dotnet = record?.dotnet || record?.default?.dotnet;
    if (!dotnet || typeof dotnet.create !== 'function') {
        throw new Error('wasm-dotnet expected a dotnet.js module exporting dotnet.create().');
    }
    return dotnet;
}
function readPath(root, path) {
    let current = root;
    for (const part of path) {
        if (!current || typeof current !== 'object')
            return undefined;
        current = current[part];
    }
    return current;
}
function findBridge(exports) {
    const candidates = [
        readPath(exports, ['WasmDotnet', 'Compiler', 'CompilerHost']),
        readPath(exports, ['WasmDotnet.Compiler', 'CompilerHost']),
        readPath(exports, ['CompilerHost']),
        exports
    ];
    for (const candidate of candidates) {
        const bridge = candidate;
        if (bridge &&
            (typeof bridge.Compile === 'function' || typeof bridge.compile === 'function') &&
            (typeof bridge.Run === 'function' || typeof bridge.run === 'function')) {
            return bridge;
        }
    }
    throw new Error('wasm-dotnet runtime did not export CompilerHost.Compile and CompilerHost.Run.');
}
async function callJson(method, payload) {
    const response = await method(JSON.stringify(payload));
    return JSON.parse(response);
}
export function resetDotnetCompilerRuntimeForTests() {
    runtimePromises.clear();
}
export async function loadDotnetCompilerRuntime(options = {}) {
    const dotnetJsUrl = resolveDotnetJsUrl(options);
    const key = `${dotnetJsUrl}\n${options.mainAssemblyName || ''}\n${options.dotnetModule ? 'injected' : ''}\n${options.diagnosticTracing ? 'trace' : ''}`;
    const cached = runtimePromises.get(key);
    if (cached)
        return await cached;
    const promise = Promise.resolve().then(async () => {
        const dotnetModule = options.dotnetModule || (await import(/* @vite-ignore */ dotnetJsUrl));
        let builder = getDotnetBuilder(dotnetModule);
        let fatalError;
        const pending = new Set();
        const abort = (reason) => {
            if (fatalError)
                return;
            fatalError = reason instanceof Error ? reason : new Error(String(reason));
            for (const reject of pending)
                reject(fatalError);
            pending.clear();
            if (runtimePromises.get(key) === promise)
                runtimePromises.delete(key);
            try {
                options.onFatalError?.(fatalError);
            }
            catch {
                // Notification errors must not replace the original runtime failure.
            }
        };
        const call = (action) => {
            if (fatalError)
                return Promise.reject(fatalError);
            return new Promise((resolve, reject) => {
                pending.add(reject);
                void Promise.resolve()
                    .then(() => {
                    if (fatalError)
                        throw fatalError;
                    return action();
                })
                    .then(resolve, reject)
                    .finally(() => pending.delete(reject));
            });
        };
        if (builder.withModuleConfig) {
            builder = builder.withModuleConfig({
                onAbort: abort,
                onExit: (code) => abort(new Error(`.NET runtime exited with code ${code}`))
            });
        }
        if (builder.withConfig) {
            builder = builder.withConfig({
                jsThreadBlockingMode: 'DangerousAllowBlockingWait'
            });
        }
        if (builder.withDiagnosticTracing) {
            builder = builder.withDiagnosticTracing(Boolean(options.diagnosticTracing));
        }
        const runtime = await call(() => builder.create());
        if (typeof runtime.getAssemblyExports !== 'function') {
            throw new Error('wasm-dotnet runtime did not expose getAssemblyExports().');
        }
        const assemblyName = options.mainAssemblyName ||
            runtime.getConfig?.().mainAssemblyName ||
            'WasmDotnet.Compiler.dll';
        const getAssemblyExports = runtime.getAssemblyExports.bind(runtime);
        const exports = await call(() => getAssemblyExports(assemblyName));
        const bridge = findBridge(exports);
        const compile = bridge.Compile || bridge.compile;
        const run = bridge.Run || bridge.run;
        if (!compile || !run) {
            throw new Error('wasm-dotnet compiler bridge is incomplete.');
        }
        return {
            compile(request) {
                return call(() => callJson(compile.bind(bridge), request));
            },
            run(request) {
                return call(() => callJson(run.bind(bridge), request));
            }
        };
    });
    runtimePromises.set(key, promise);
    try {
        return await promise;
    }
    catch (error) {
        if (runtimePromises.get(key) === promise) {
            runtimePromises.delete(key);
        }
        throw error;
    }
}
//# sourceMappingURL=runtime-loader.js.map