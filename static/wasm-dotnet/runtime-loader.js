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
        const referenceSets = new WeakMap();
        const registeredReferenceSets = [];
        const sameReferences = (left, right) => left.length === right.length &&
            left.every((entry, i) => entry.name === right[i].name && entry.bytesBase64 === right[i].bytesBase64);
        const register = typeof bridge.RegisterReferences === 'function' ? bridge.RegisterReferences : undefined;
        const referenceId = (references) => {
            const snapshot = references.map(({ name, bytesBase64 }) => ({ name, bytesBase64 }));
            const previous = referenceSets.get(references);
            if (previous && !previous.failed && sameReferences(previous.snapshot, snapshot)) {
                return previous.id;
            }
            const equivalent = registeredReferenceSets.find((entry) => !entry.failed && sameReferences(entry.snapshot, snapshot));
            if (equivalent) {
                referenceSets.set(references, equivalent);
                return equivalent.id;
            }
            const id = call(async () => {
                const response = await callJson(register.bind(bridge), { references: snapshot });
                if (response.error || !/^[a-f0-9]{32}$/.test(response.referenceSetId || '')) {
                    throw new Error(response.error || 'Invalid .NET reference registration response.');
                }
                return response.referenceSetId;
            });
            const entry = { snapshot, id, failed: false };
            registeredReferenceSets.push(entry);
            referenceSets.set(references, entry);
            void id.catch(() => {
                entry.failed = true;
                const index = registeredReferenceSets.indexOf(entry);
                if (index >= 0)
                    registeredReferenceSets.splice(index, 1);
                if (referenceSets.get(references) === entry)
                    referenceSets.delete(references);
            });
            return id;
        };
        return {
            ...(register
                ? {
                    async prepareReferences(references) {
                        if (references.length)
                            await referenceId(references);
                    }
                }
                : {}),
            compile(request) {
                if (register && request.references?.length) {
                    const { references, ...rest } = request;
                    return call(async () => callJson(compile.bind(bridge), {
                        ...rest,
                        referenceSetId: await referenceId(references)
                    }));
                }
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