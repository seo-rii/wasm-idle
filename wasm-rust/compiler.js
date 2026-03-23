import { resolveVersionedAssetUrl } from './asset-url.js';
import { PREVIEW2_COMPONENT_RUNTIME_ASSETS } from './browser-component-tools.js';
import { linkBitcodeWithLlvmWasm } from './browser-linker.js';
import { createModuleWorker } from './module-worker.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, resolveRuntimeAssetUrl, resolveTargetManifest } from './runtime-manifest.js';
import { readMirroredBitcode } from './rustc-runtime.js';
import { readWorkerFailure, WORKER_STATUS_BUFFER_BYTES } from './worker-status.js';
const SUPPORTED_EDITIONS = new Set(['2021', '2024']);
const SUPPORTED_CRATE_TYPES = new Set(['bin']);
const SUPPORTED_TARGET_TRIPLES = new Set([
    'wasm32-wasip1',
    'wasm32-wasip2',
    'wasm32-wasip3'
]);
const PROGRESS_STAGE_RANGES = {
    manifest: [0, 1],
    'fetch-rustc': [1, 3],
    'fetch-sysroot': [3, 8],
    'prepare-fs': [8, 11],
    'init-thread-pool': [11, 15],
    'rustc-main': [15, 48],
    'await-bitcode': [48, 68],
    link: [68, 95],
    componentize: [95, 99],
    retry: [0, 99],
    done: [100, 100]
};
const rustRuntimePreloadCache = new Map();
function describeWorkerErrorEvent(event) {
    const location = event.filename
        ? `${event.filename}${event.lineno ? `:${event.lineno}` : ''}${event.colno ? `:${event.colno}` : ''}`
        : '';
    const errorMessage = event.error instanceof Error
        ? event.error.message || event.error.name
        : typeof event.error === 'string'
            ? event.error
            : '';
    const primaryMessage = errorMessage || event.message || '';
    if (primaryMessage && location) {
        return `${primaryMessage} (${location})`;
    }
    if (primaryMessage) {
        return primaryMessage;
    }
    if (location) {
        return `worker script error at ${location}`;
    }
    return 'worker script error';
}
function makeFailure(stderr, diagnostics, stdout, logs) {
    return {
        success: false,
        stdout,
        stderr,
        diagnostics,
        ...(logs && logs.length > 0 ? { logs } : {})
    };
}
function attachCompileLogs(result, logs) {
    if (logs.length === 0) {
        return result;
    }
    return {
        ...result,
        logs
    };
}
function validateRequest(request) {
    if (!request.code || request.code.trim().length === 0) {
        return 'wasm-rust requires a non-empty Rust source file';
    }
    if (request.edition && !SUPPORTED_EDITIONS.has(request.edition)) {
        return `unsupported browser compiler edition: ${request.edition}`;
    }
    if (request.crateType && !SUPPORTED_CRATE_TYPES.has(request.crateType)) {
        return `unsupported browser compiler crate type: ${request.crateType}`;
    }
    if (request.targetTriple && !SUPPORTED_TARGET_TRIPLES.has(request.targetTriple)) {
        return `unsupported browser compiler target: ${request.targetTriple}`;
    }
    return null;
}
export async function preloadBrowserRustRuntime(options = {}) {
    const defaultImportRuntimeModule = (assetUrl) => import(/* @vite-ignore */ assetUrl);
    const runPreload = async () => {
        const loadManifest = options.dependencies?.loadManifest || loadRuntimeManifest;
        const fetchImpl = options.dependencies?.fetchImpl || fetch;
        const importRuntimeModule = options.dependencies?.importRuntimeModule || defaultImportRuntimeModule;
        const preloadAsset = async (assetUrl, assetLabel) => {
            const response = await fetchImpl(assetUrl);
            if (!response.ok) {
                throw new Error(`failed to preload ${assetLabel} from ${assetUrl} (status ${response.status})`);
            }
            await response.arrayBuffer();
        };
        const runtimeBaseUrl = resolveVersionedAssetUrl(import.meta.url, './runtime/');
        let loadedManifest;
        try {
            loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v3.json'));
        }
        catch {
            try {
                loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v2.json'));
            }
            catch {
                loadedManifest = await loadManifest(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.json'));
            }
        }
        const manifest = normalizeRuntimeManifest(loadedManifest);
        const targetConfig = resolveTargetManifest(manifest, options.targetTriple);
        const versionedModuleBaseUrl = new URL(import.meta.url);
        versionedModuleBaseUrl.searchParams.set('v', manifest.version);
        const versionedRuntimeBaseUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './runtime/');
        const assetPreloads = [
            preloadAsset(resolveVersionedAssetUrl(versionedModuleBaseUrl, './compiler-worker.js').toString(), 'wasm-rust compiler worker'),
            preloadAsset(resolveVersionedAssetUrl(versionedModuleBaseUrl, './rustc-thread-worker.js').toString(), 'wasm-rust rustc thread worker'),
            preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, manifest.compiler.rustcWasm), `wasm-rust runtime asset ${manifest.compiler.rustcWasm}`),
            preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.llcWasm || 'llvm/llc.wasm'), `wasm-rust runtime asset ${targetConfig.compile.llvm.llcWasm || 'llvm/llc.wasm'}`),
            preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.lldWasm || 'llvm/lld.wasm'), `wasm-rust runtime asset ${targetConfig.compile.llvm.lldWasm || 'llvm/lld.wasm'}`),
            preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.lldData || 'llvm/lld.data'), `wasm-rust runtime asset ${targetConfig.compile.llvm.lldData || 'llvm/lld.data'}`)
        ];
        if (targetConfig.sysrootPack) {
            assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.sysrootPack.index), `wasm-rust runtime asset ${targetConfig.sysrootPack.index}`), preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.sysrootPack.asset), `wasm-rust runtime asset ${targetConfig.sysrootPack.asset}`));
        }
        else if (targetConfig.sysrootFiles) {
            for (const entry of targetConfig.sysrootFiles) {
                assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, entry.asset), `wasm-rust runtime asset ${entry.asset}`));
            }
        }
        if (targetConfig.compile.link.pack) {
            assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.link.pack.index), `wasm-rust runtime asset ${targetConfig.compile.link.pack.index}`), preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.link.pack.asset), `wasm-rust runtime asset ${targetConfig.compile.link.pack.asset}`));
        }
        else {
            if (targetConfig.compile.link.allocatorObjectAsset) {
                assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.link.allocatorObjectAsset), `wasm-rust runtime asset ${targetConfig.compile.link.allocatorObjectAsset}`));
            }
            for (const entry of targetConfig.compile.link.files || []) {
                assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, entry.asset), `wasm-rust runtime asset ${entry.asset}`));
            }
        }
        const modulePreloads = [
            importRuntimeModule(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.llc)),
            importRuntimeModule(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.lld))
        ];
        if (targetConfig.compile.kind === 'llvm-wasm+component-encoder' ||
            targetConfig.execution.kind === 'preview2-component') {
            for (const assetPath of PREVIEW2_COMPONENT_RUNTIME_ASSETS) {
                if (assetPath.endsWith('.js')) {
                    modulePreloads.push(importRuntimeModule(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, assetPath)));
                    continue;
                }
                assetPreloads.push(preloadAsset(resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, assetPath), `wasm-rust runtime asset ${assetPath}`));
            }
        }
        await Promise.all([...assetPreloads, ...modulePreloads]);
    };
    if (options.dependencies) {
        await runPreload();
        return;
    }
    const cacheKey = options.targetTriple || '__default__';
    let cachedPreload = rustRuntimePreloadCache.get(cacheKey);
    if (!cachedPreload) {
        cachedPreload = runPreload();
        rustRuntimePreloadCache.set(cacheKey, cachedPreload);
        cachedPreload.catch(() => {
            if (rustRuntimePreloadCache.get(cacheKey) === cachedPreload) {
                rustRuntimePreloadCache.delete(cacheKey);
            }
        });
    }
    await cachedPreload;
}
export async function compileRust(request, dependencies = {}) {
    const validationError = validateRequest(request);
    if (validationError) {
        return makeFailure(validationError);
    }
    if ((!dependencies.createWorker && typeof Worker === 'undefined') ||
        typeof SharedArrayBuffer === 'undefined' ||
        typeof Atomics === 'undefined') {
        return makeFailure('wasm-rust requires a cross-origin-isolated worker environment with SharedArrayBuffer support');
    }
    const maxBrowserAttempts = 5;
    const compileLogs = [];
    const emitCompileLog = (message, level = 'log') => {
        if (!request.log) {
            return;
        }
        if (level === 'warn') {
            console.warn(message);
            return;
        }
        if (level === 'error') {
            console.error(message);
            return;
        }
        if (level === 'debug') {
            console.debug(message);
            return;
        }
        console.log(message);
    };
    const recordPersistentCompileLog = (message, level = 'log') => {
        if (request.log) {
            compileLogs.push({
                level,
                message
            });
        }
        emitCompileLog(message, level);
    };
    const flushAttemptCompileLogs = (attemptCompileLogs) => {
        if (request.log) {
            compileLogs.push(...attemptCompileLogs);
        }
        for (const record of attemptCompileLogs) {
            emitCompileLog(record.message, record.level);
        }
    };
    let lastProgressPercent = 0;
    const emitCompileProgress = (stage, attempt, payload) => {
        if (!request.onProgress) {
            return;
        }
        const safeTotal = Math.max(1, payload.total);
        const safeCompleted = Math.max(0, Math.min(payload.completed, safeTotal));
        let percent = lastProgressPercent;
        if (stage === 'done') {
            percent = 100;
        }
        else if (stage !== 'retry') {
            const [startPercent, endPercent] = PROGRESS_STAGE_RANGES[stage];
            percent =
                startPercent + ((endPercent - startPercent) * safeCompleted) / safeTotal;
            percent = Math.min(99, Math.max(lastProgressPercent, percent));
        }
        lastProgressPercent = percent;
        try {
            request.onProgress({
                stage,
                attempt,
                maxAttempts: maxBrowserAttempts,
                completed: safeCompleted,
                total: safeTotal,
                percent,
                message: payload.message,
                bytesCompleted: payload.bytesCompleted,
                bytesTotal: payload.bytesTotal
            });
        }
        catch { }
    };
    const now = dependencies.now || (() => Date.now());
    const sleep = dependencies.sleep ||
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const readCompileLogs = () => (request.log ? compileLogs.map((entry) => entry.message) : []);
    const retryableFailurePatterns = [
        'worker script error',
        'failed to fetch dynamically imported module',
        'importing a module script failed',
        'memory access out of bounds',
        'browser rustc timed out before producing llvm bitcode',
        'operation does not support unaligned accesses',
        'rustc browser thread pool exhausted',
        'unreachable',
        'browser rustc helper thread failed before producing llvm bitcode',
        'invalid enum variant tag while decoding',
        'found invalid metadata files for crate',
        'failed to parse rlib',
        "can't find crate for `std`",
        'the compiler unexpectedly panicked'
    ];
    emitCompileProgress('manifest', 1, {
        completed: 0,
        total: 1,
        message: 'loading runtime manifest'
    });
    const runtimeBaseUrl = resolveVersionedAssetUrl(import.meta.url, './runtime/');
    let loadedManifest;
    try {
        loadedManifest = await (dependencies.loadManifest || loadRuntimeManifest)(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v3.json'));
    }
    catch {
        try {
            loadedManifest = await (dependencies.loadManifest || loadRuntimeManifest)(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.v2.json'));
        }
        catch {
            loadedManifest = await (dependencies.loadManifest || loadRuntimeManifest)(resolveVersionedAssetUrl(runtimeBaseUrl, 'runtime-manifest.json'));
        }
    }
    const manifest = normalizeRuntimeManifest(loadedManifest);
    let targetConfig;
    try {
        targetConfig = resolveTargetManifest(manifest, request.targetTriple);
    }
    catch (error) {
        return makeFailure(error instanceof Error ? error.message : String(error));
    }
    const versionedModuleBaseUrl = new URL(import.meta.url);
    versionedModuleBaseUrl.searchParams.set('v', manifest.version);
    const versionedRuntimeBaseUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './runtime/');
    const compileTimeoutMs = request.prepare
        ? Math.max(manifest.compiler.compileTimeoutMs, 120_000)
        : manifest.compiler.compileTimeoutMs;
    emitCompileProgress('manifest', 1, {
        completed: 1,
        total: 1,
        message: `loaded runtime manifest for ${targetConfig.targetTriple}`
    });
    recordPersistentCompileLog(`[wasm-rust] manifest loaded target=${targetConfig.targetTriple} timeout=${compileTimeoutMs}ms idle=${manifest.compiler.artifactIdleMs}ms memory=${manifest.compiler.rustcMemory.initialPages}/${manifest.compiler.rustcMemory.maximumPages}`);
    const helperThreadFailureGraceMs = Math.max(1_000, Math.min(4_000, manifest.compiler.artifactIdleMs * 2));
    let lastFailure = makeFailure('browser rustc failed before emitting LLVM bitcode');
    const { onProgress: _ignoredOnProgress, ...workerRequest } = request;
    for (let attempt = 1; attempt <= maxBrowserAttempts; attempt += 1) {
        const attemptCompileLogs = [];
        const recordAttemptCompileLog = (message, level = 'log') => {
            attemptCompileLogs.push({
                level,
                message
            });
        };
        const workerUrl = resolveVersionedAssetUrl(versionedModuleBaseUrl, './compiler-worker.js');
        workerUrl.searchParams.set('attempt', String(attempt));
        const worker = (dependencies.createWorker ||
            ((url) => createModuleWorker(url)))(workerUrl);
        const sharedBitcodeBuffer = new SharedArrayBuffer(16 + manifest.compiler.workerSharedOutputBytes);
        const sharedStatusBuffer = new SharedArrayBuffer(WORKER_STATUS_BUFFER_BYTES);
        const workerResult = new Promise((resolve, reject) => {
            const handleMessage = (event) => {
                if (event.data.type === 'log') {
                    recordAttemptCompileLog(event.data.message);
                    return;
                }
                if (event.data.type === 'progress') {
                    emitCompileProgress(event.data.progress.stage, attempt, event.data.progress);
                    return;
                }
                worker.removeEventListener('message', handleMessage);
                worker.removeEventListener('error', handleError);
                resolve(event.data);
            };
            const handleError = (event) => {
                worker.removeEventListener('message', handleMessage);
                worker.removeEventListener('error', handleError);
                reject(new Error(`${describeWorkerErrorEvent(event)} [worker=${workerUrl.toString()}]`));
            };
            worker.addEventListener('message', handleMessage);
            worker.addEventListener('error', handleError);
        });
        worker.postMessage({
            type: 'compile',
            runtimeBaseUrl: versionedRuntimeBaseUrl.toString(),
            manifest,
            request: workerRequest,
            sharedBitcodeBuffer,
            sharedStatusBuffer
        });
        recordAttemptCompileLog(`[wasm-rust] compile worker started attempt=${attempt}/${maxBrowserAttempts}`);
        emitCompileProgress('await-bitcode', attempt, {
            completed: 0,
            total: 1,
            message: `waiting for mirrored LLVM bitcode attempt ${attempt}/${maxBrowserAttempts}`
        });
        const deadline = now() + compileTimeoutMs;
        let lastSequence = 0;
        let lastSequenceChange = now();
        let settledMessage = null;
        let workerResultConsumed = false;
        let workerBootstrapError = null;
        let attemptResult = null;
        let pendingHelperThreadFailure = null;
        let pendingHelperThreadFailureObservedAt = 0;
        let deferredWorkerError = null;
        while (!settledMessage && !workerBootstrapError && now() < deadline) {
            const raced = await Promise.race([
                ...(!workerResultConsumed
                    ? [
                        workerResult
                            .then((message) => ({ type: 'message', message }))
                            .catch((error) => ({ type: 'worker-error', error }))
                    ]
                    : []),
                sleep(250).then(() => ({ type: 'tick' }))
            ]);
            if (raced.type === 'message') {
                workerResultConsumed = true;
                const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
                if (raced.message.type === 'error') {
                    const normalizedWorkerFailureText = [
                        raced.message.message || '',
                        raced.message.stderr || ''
                    ]
                        .join('\n')
                        .toLowerCase();
                    const shouldDeferWorkerFailure = mirrored.length === 0 &&
                        !mirrored.overflowed &&
                        mirrored.writeSequence > 0 &&
                        normalizedWorkerFailureText.includes('browser rustc helper thread failed before producing llvm bitcode');
                    if (shouldDeferWorkerFailure) {
                        deferredWorkerError = raced.message;
                        pendingHelperThreadFailure =
                            raced.message.stderr || raced.message.message || pendingHelperThreadFailure;
                        pendingHelperThreadFailureObservedAt = now();
                        continue;
                    }
                }
                settledMessage = raced.message;
                break;
            }
            if (raced.type === 'worker-error') {
                workerBootstrapError =
                    raced.error instanceof Error ? raced.error : new Error(String(raced.error));
                break;
            }
            const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
            const helperThreadFailure = readWorkerFailure(sharedStatusBuffer);
            if (helperThreadFailure && !pendingHelperThreadFailure) {
                pendingHelperThreadFailure = helperThreadFailure;
                pendingHelperThreadFailureObservedAt = now();
            }
            if (deferredWorkerError && mirrored.writeSequence !== lastSequence) {
                pendingHelperThreadFailureObservedAt = now();
            }
            if (mirrored.length === 0 && pendingHelperThreadFailure) {
                if (now() - pendingHelperThreadFailureObservedAt >= helperThreadFailureGraceMs) {
                    if (deferredWorkerError) {
                        settledMessage = deferredWorkerError;
                        deferredWorkerError = null;
                        break;
                    }
                    worker.terminate();
                    attemptResult = makeFailure(pendingHelperThreadFailure);
                    break;
                }
            }
            else if (mirrored.length > 0) {
                pendingHelperThreadFailure = null;
                pendingHelperThreadFailureObservedAt = 0;
                deferredWorkerError = null;
            }
            if (mirrored.writeSequence !== lastSequence) {
                lastSequence = mirrored.writeSequence;
                lastSequenceChange = now();
                recordAttemptCompileLog(`[wasm-rust] mirrored artifact updated seq=${mirrored.writeSequence} bytes=${mirrored.length} overflowed=${mirrored.overflowed}`);
                continue;
            }
            if (mirrored.length > 0 && now() - lastSequenceChange >= manifest.compiler.artifactIdleMs) {
                worker.terminate();
                if (mirrored.overflowed) {
                    attemptResult = makeFailure('wasm-rust mirrored bitcode buffer overflowed before backend linking');
                    break;
                }
                recordAttemptCompileLog('[wasm-rust] mirrored bitcode settled; linking through llvm-wasm');
                emitCompileProgress('await-bitcode', attempt, {
                    completed: 1,
                    total: 1,
                    message: 'mirrored LLVM bitcode ready'
                });
                emitCompileProgress('link', attempt, {
                    completed: 0,
                    total: 1,
                    message: 'linking mirrored LLVM bitcode'
                });
                let artifact;
                try {
                    artifact = await (dependencies.linkBitcode || linkBitcodeWithLlvmWasm)(mirrored.bytes, manifest, targetConfig, versionedRuntimeBaseUrl.toString(), {
                        onProgress: (progress) => emitCompileProgress(progress.stage, attempt, progress)
                    });
                }
                catch (error) {
                    recordAttemptCompileLog(`[wasm-rust] llvm-wasm link failed after mirrored bitcode: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    attemptResult = makeFailure(`browser rustc emitted LLVM bitcode but llvm-wasm link failed: ${error instanceof Error ? error.message : String(error)}`);
                    break;
                }
                flushAttemptCompileLogs(attemptCompileLogs);
                emitCompileProgress('done', attempt, {
                    completed: 1,
                    total: 1,
                    message: 'compile artifact ready'
                });
                return attachCompileLogs({
                    success: true,
                    artifact
                }, readCompileLogs());
            }
        }
        if (!attemptResult && workerBootstrapError) {
            worker.terminate();
            recordAttemptCompileLog(`[wasm-rust] compile worker bootstrap failed ${workerBootstrapError.message}`, 'debug');
            attemptResult = makeFailure(workerBootstrapError.message);
        }
        if (!attemptResult && !settledMessage) {
            worker.terminate();
            const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
            if (mirrored.length > 0 && !mirrored.overflowed) {
                recordAttemptCompileLog('[wasm-rust] compile timeout reached after mirrored bitcode appeared; proceeding to llvm-wasm link', 'debug');
                emitCompileProgress('await-bitcode', attempt, {
                    completed: 1,
                    total: 1,
                    message: 'mirrored LLVM bitcode ready after timeout'
                });
                emitCompileProgress('link', attempt, {
                    completed: 0,
                    total: 1,
                    message: 'linking mirrored LLVM bitcode'
                });
                let artifact;
                try {
                    artifact = await (dependencies.linkBitcode || linkBitcodeWithLlvmWasm)(mirrored.bytes, manifest, targetConfig, versionedRuntimeBaseUrl.toString(), {
                        onProgress: (progress) => emitCompileProgress(progress.stage, attempt, progress)
                    });
                }
                catch (error) {
                    recordAttemptCompileLog(`[wasm-rust] llvm-wasm link failed after timeout fallback: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    attemptResult = makeFailure(`browser rustc emitted LLVM bitcode but llvm-wasm link failed: ${error instanceof Error ? error.message : String(error)}`);
                    break;
                }
                flushAttemptCompileLogs(attemptCompileLogs);
                emitCompileProgress('done', attempt, {
                    completed: 1,
                    total: 1,
                    message: 'compile artifact ready'
                });
                return attachCompileLogs({
                    success: true,
                    artifact
                }, readCompileLogs());
            }
            if (mirrored.overflowed) {
                attemptResult = makeFailure('wasm-rust mirrored bitcode buffer overflowed before backend linking');
            }
            else {
                recordAttemptCompileLog('[wasm-rust] compile timed out before mirrored bitcode appeared', 'debug');
                attemptResult = makeFailure('browser rustc timed out before producing LLVM bitcode');
            }
        }
        if (!attemptResult && settledMessage) {
            worker.terminate();
            const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
            if (settledMessage.type === 'error') {
                if (mirrored.length > 0 && !mirrored.overflowed) {
                    recordAttemptCompileLog('[wasm-rust] worker errored with mirrored bitcode present; linking through llvm-wasm');
                    emitCompileProgress('await-bitcode', attempt, {
                        completed: 1,
                        total: 1,
                        message: 'mirrored LLVM bitcode ready after worker error'
                    });
                    emitCompileProgress('link', attempt, {
                        completed: 0,
                        total: 1,
                        message: 'linking mirrored LLVM bitcode'
                    });
                    try {
                        const artifact = await (dependencies.linkBitcode || linkBitcodeWithLlvmWasm)(mirrored.bytes, manifest, targetConfig, versionedRuntimeBaseUrl.toString(), {
                            onProgress: (progress) => emitCompileProgress(progress.stage, attempt, progress)
                        });
                        flushAttemptCompileLogs(attemptCompileLogs);
                        emitCompileProgress('done', attempt, {
                            completed: 1,
                            total: 1,
                            message: 'compile artifact ready'
                        });
                        return attachCompileLogs({
                            success: true,
                            stdout: settledMessage.stdout,
                            diagnostics: settledMessage.diagnostics,
                            artifact
                        }, readCompileLogs());
                    }
                    catch (error) {
                        recordAttemptCompileLog(`[wasm-rust] llvm-wasm link failed after worker error: ${error instanceof Error ? error.message : String(error)}`, 'error');
                        attemptResult = makeFailure(`browser rustc emitted LLVM bitcode but llvm-wasm link failed: ${error instanceof Error ? error.message : String(error)}`, settledMessage.diagnostics, settledMessage.stdout);
                    }
                }
                else if (mirrored.overflowed) {
                    attemptResult = makeFailure('wasm-rust mirrored bitcode buffer overflowed before backend linking', undefined, settledMessage.stdout);
                }
                else {
                    attemptResult = makeFailure(settledMessage.stderr || settledMessage.message, settledMessage.diagnostics, settledMessage.stdout);
                }
            }
            else if (mirrored.length > 0 && !mirrored.overflowed) {
                recordAttemptCompileLog('[wasm-rust] worker settled with mirrored bitcode; linking through llvm-wasm');
                emitCompileProgress('await-bitcode', attempt, {
                    completed: 1,
                    total: 1,
                    message: 'mirrored LLVM bitcode ready after worker exit'
                });
                emitCompileProgress('link', attempt, {
                    completed: 0,
                    total: 1,
                    message: 'linking mirrored LLVM bitcode'
                });
                let artifact = null;
                try {
                    artifact = await (dependencies.linkBitcode || linkBitcodeWithLlvmWasm)(mirrored.bytes, manifest, targetConfig, versionedRuntimeBaseUrl.toString(), {
                        onProgress: (progress) => emitCompileProgress(progress.stage, attempt, progress)
                    });
                }
                catch (error) {
                    recordAttemptCompileLog(`[wasm-rust] llvm-wasm link failed after worker settled: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    attemptResult = makeFailure(`browser rustc emitted LLVM bitcode but llvm-wasm link failed: ${error instanceof Error ? error.message : String(error)}`, settledMessage.diagnostics, settledMessage.stdout);
                }
                if (!attemptResult) {
                    if (!artifact) {
                        attemptResult = makeFailure('browser rustc emitted LLVM bitcode but llvm-wasm returned no wasm artifact', settledMessage.diagnostics, settledMessage.stdout);
                        continue;
                    }
                    flushAttemptCompileLogs(attemptCompileLogs);
                    emitCompileProgress('done', attempt, {
                        completed: 1,
                        total: 1,
                        message: 'compile artifact ready'
                    });
                    return attachCompileLogs({
                        success: true,
                        stdout: settledMessage.stdout,
                        diagnostics: settledMessage.diagnostics,
                        artifact
                    }, readCompileLogs());
                }
            }
            else if (mirrored.overflowed) {
                attemptResult = makeFailure('wasm-rust mirrored bitcode buffer overflowed before backend linking', undefined, settledMessage.stdout);
            }
            else {
                attemptResult = makeFailure(settledMessage.stderr || 'browser rustc failed before emitting LLVM bitcode', settledMessage.diagnostics, settledMessage.stdout);
            }
        }
        if (!attemptResult) {
            attemptResult = makeFailure('browser rustc failed before emitting LLVM bitcode');
        }
        lastFailure = attemptResult;
        const attemptStderr = attemptResult.stderr || '';
        const normalizedAttemptStderr = attemptStderr.toLowerCase();
        const shouldRetry = attempt < maxBrowserAttempts &&
            Boolean(attemptStderr) &&
            retryableFailurePatterns.some((pattern) => normalizedAttemptStderr.includes(pattern));
        if (shouldRetry) {
            recordPersistentCompileLog(`[wasm-rust] browser rustc attempt ${attempt}/${maxBrowserAttempts} failed; retrying`, 'warn');
            emitCompileProgress('retry', Math.min(attempt + 1, maxBrowserAttempts), {
                completed: Math.min(attempt + 1, maxBrowserAttempts),
                total: maxBrowserAttempts,
                message: `retrying browser rustc after attempt ${attempt}/${maxBrowserAttempts} failed`
            });
        }
        else {
            flushAttemptCompileLogs(attemptCompileLogs);
            return attachCompileLogs(attemptResult, readCompileLogs());
        }
        await sleep(Math.min(500 * attempt, 2_000));
    }
    return attachCompileLogs(lastFailure, readCompileLogs());
}
