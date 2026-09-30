import { Directory, File, OpenFile, PreopenDirectory, WASI } from './vendor/browser_wasi_shim/index.js';
import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, loadRuntimePackEntries, loadRuntimeSysrootChunks } from './runtime-asset.js';
import { CaptureFd, ensureGuestDirectory, normalizeGuestPath, readGuestFile, writeGuestFile } from './wasi-guest.js';
import { assertGoInstanceMemoryLimit } from './wasm-memory.js';
import { compileGoToolModule } from './tool-module.js';
const DEFAULT_MAX_WASM_MEMORY_BYTES = 512 * 1024 * 1024;
function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('wasm-go tool execution aborted', 'AbortError');
    }
}
async function loadSysrootFiles(plan, runtimeBaseUrl, fetchImpl, reportAssetProgress, options = {}) {
    if (plan.sysrootChunks) {
        return loadRuntimeSysrootChunks(runtimeBaseUrl, plan.sysrootChunks, fetchImpl, reportAssetProgress, options);
    }
    if (plan.sysrootPack) {
        return await loadRuntimePackEntries(runtimeBaseUrl, plan.sysrootPack, fetchImpl, {
            index: (loaded, total) => reportAssetProgress?.(plan.sysrootPack.index, loaded, total),
            asset: (loaded, total) => reportAssetProgress?.(plan.sysrootPack.asset, loaded, total)
        }, options);
    }
    return await Promise.all((plan.sysrootFiles || []).map(async (entry) => ({
        runtimePath: entry.runtimePath,
        bytes: await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, entry.asset), `sysroot asset ${entry.runtimePath}`, fetchImpl, true, (loaded, total) => reportAssetProgress?.(entry.asset, loaded, total), options)
    })));
}
function collectInputFiles(invocation, plan) {
    const files = [...invocation.inputFiles];
    if (invocation.tool === 'link' && plan.link) {
        const compileOutput = plan.compile.outputPath;
        if (!files.some((file) => file.path === compileOutput)) {
            throw new Error(`missing compile output ${compileOutput} for link invocation`);
        }
    }
    return files;
}
export async function executeGoToolInvocation(invocation, plan, runtimeBaseUrl, fetchImpl = fetch, reportAssetProgress, options = {}) {
    throwIfAborted(options.signal);
    const maxWasmMemoryBytes = options.maxWasmMemoryBytes ?? DEFAULT_MAX_WASM_MEMORY_BYTES;
    const inputFiles = collectInputFiles(invocation, plan);
    const startupController = new AbortController();
    const relayAbort = () => startupController.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', relayAbort, { once: true });
    const startupOptions = { ...options, signal: startupController.signal };
    // Tool compilation does not need the sysroot. Observe both branches immediately
    // so either failure is reported even while its peer is still pending.
    let sysrootFiles;
    let module;
    try {
        [sysrootFiles, module] = await Promise.all([
            loadSysrootFiles(plan, runtimeBaseUrl, fetchImpl, reportAssetProgress, startupOptions),
            (async () => {
                const toolBytes = await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, invocation.toolAsset), `${invocation.tool}.wasm`, fetchImpl, true, (loaded, total) => reportAssetProgress?.(invocation.toolAsset, loaded, total), startupOptions);
                throwIfAborted(startupController.signal);
                return await compileGoToolModule(toolBytes, maxWasmMemoryBytes, `${invocation.tool}.wasm`, startupController.signal);
            })()
        ]);
    }
    catch (error) {
        startupController.abort(error);
        throw error;
    }
    finally {
        options.signal?.removeEventListener('abort', relayAbort);
    }
    throwIfAborted(options.signal);
    const root = new Directory(new Map());
    ensureGuestDirectory(root, '/tmp');
    for (const entry of sysrootFiles) {
        writeGuestFile(root, entry.runtimePath, entry.bytes, true);
    }
    for (const file of inputFiles) {
        writeGuestFile(root, file.path, file.contents);
    }
    ensureGuestDirectory(root, normalizeGuestPath(invocation.outputPath).split('/').slice(0, -1).join('/'));
    const stdout = new CaptureFd();
    const stderr = new CaptureFd();
    const wasiInstance = new WASI(invocation.args, Object.entries(invocation.env).map(([key, value]) => `${key}=${value}`), [
        new OpenFile(new File(new Uint8Array(), { readonly: true })),
        stdout,
        stderr,
        new PreopenDirectory('/', root.contents)
    ], { debug: false });
    throwIfAborted(options.signal);
    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiInstance.wasiImport
    });
    assertGoInstanceMemoryLimit(instance, maxWasmMemoryBytes, `${invocation.tool}.wasm`);
    throwIfAborted(options.signal);
    const exitCode = wasiInstance.start(instance);
    assertGoInstanceMemoryLimit(instance, maxWasmMemoryBytes, `${invocation.tool}.wasm`);
    throwIfAborted(options.signal);
    const outputBytes = readGuestFile(root, invocation.outputPath);
    return {
        exitCode,
        stdout: stdout.getText(),
        stderr: stderr.getText(),
        outputs: outputBytes
            ? {
                [invocation.outputPath]: outputBytes
            }
            : {}
    };
}
//# sourceMappingURL=tool-runtime.js.map