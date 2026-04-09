import { resolveVersionedAssetUrl } from './asset-url.js';
import { linkBitcodeWithLlvmWasm } from './browser-linker.js';
import { attachCompileLogs, describeWorkerErrorEvent, makeFailure, validateCompileRequest } from './compiler-support.js';
import { preloadBrowserRustRuntime } from './compiler-preload.js';
import { loadBundledRuntimeContext } from './compiler-runtime.js';
import { createModuleWorker } from './module-worker.js';
import { classifyRetryableFailureKind } from './retryable-failure-kind.js';
import { readMirroredBitcode } from './rustc-runtime.js';
import { readWorkerFailure, WORKER_STATUS_BUFFER_BYTES } from './worker-status.js';
export { preloadBrowserRustRuntime };
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
export async function compileRust(request, dependencies = {}) {
    const validationError = validateCompileRequest(request);
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
    const flushAttemptCompileLogs = (attemptCompileLogs, emit = true) => {
        if (request.log) {
            compileLogs.push(...attemptCompileLogs);
        }
        if (!emit) {
            return;
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
            if (payload.bytesCompleted !== undefined &&
                payload.bytesTotal !== undefined &&
                payload.bytesTotal > 0) {
                percent =
                    startPercent +
                        ((endPercent - startPercent) *
                            Math.max(0, Math.min(payload.bytesCompleted, payload.bytesTotal))) /
                            payload.bytesTotal;
            }
            else {
                percent =
                    startPercent + ((endPercent - startPercent) * safeCompleted) / safeTotal;
            }
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
                ...(payload.message !== undefined ? { message: payload.message } : {}),
                ...(payload.bytesCompleted !== undefined
                    ? { bytesCompleted: payload.bytesCompleted }
                    : {}),
                ...(payload.bytesTotal !== undefined ? { bytesTotal: payload.bytesTotal } : {})
            });
        }
        catch { }
    };
    const now = dependencies.now || (() => Date.now());
    const sleep = dependencies.sleep ||
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const readCompileLogs = () => (request.log ? compileLogs.map((entry) => entry.message) : []);
    const readCompileLogRecords = () => (request.log ? [...compileLogs] : []);
    emitCompileProgress('manifest', 1, {
        completed: 0,
        total: 1,
        message: 'loading runtime manifest'
    });
    try {
        const { manifest, targetConfig, versionedModuleBaseUrl, versionedRuntimeBaseUrl } = await loadBundledRuntimeContext(dependencies.loadManifest, request.targetTriple);
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
            let attemptFailureKind = null;
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
                        const workerFailureKind = classifyRetryableFailureKind([raced.message.message || '', raced.message.stderr || ''].join('\n'));
                        const shouldDeferWorkerFailure = mirrored.length === 0 &&
                            !mirrored.overflowed &&
                            mirrored.writeSequence > 0 &&
                            (raced.message.failureKind === 'helper-thread' ||
                                workerFailureKind === 'helper-thread');
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
                        attemptFailureKind = 'helper-thread';
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
                    }, readCompileLogs(), readCompileLogRecords());
                }
            }
            if (!attemptResult && workerBootstrapError) {
                worker.terminate();
                recordAttemptCompileLog(`[wasm-rust] compile worker bootstrap failed ${workerBootstrapError.message}`, 'debug');
                attemptFailureKind = classifyRetryableFailureKind(workerBootstrapError.message);
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
                    }, readCompileLogs(), readCompileLogRecords());
                }
                if (mirrored.overflowed) {
                    attemptResult = makeFailure('wasm-rust mirrored bitcode buffer overflowed before backend linking');
                }
                else {
                    recordAttemptCompileLog('[wasm-rust] compile timed out before mirrored bitcode appeared', 'debug');
                    attemptFailureKind = 'compile-timeout';
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
                                artifact,
                                ...(settledMessage.stdout !== undefined
                                    ? { stdout: settledMessage.stdout }
                                    : {}),
                                ...(settledMessage.diagnostics
                                    ? { diagnostics: settledMessage.diagnostics }
                                    : {})
                            }, readCompileLogs(), readCompileLogRecords());
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
                        attemptFailureKind =
                            settledMessage.failureKind ||
                                classifyRetryableFailureKind([settledMessage.stderr || '', settledMessage.message || ''].join('\n'));
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
                            artifact,
                            ...(settledMessage.stdout !== undefined
                                ? { stdout: settledMessage.stdout }
                                : {}),
                            ...(settledMessage.diagnostics
                                ? { diagnostics: settledMessage.diagnostics }
                                : {})
                        }, readCompileLogs(), readCompileLogRecords());
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
            const derivedRetryableFailureKind = attemptFailureKind || classifyRetryableFailureKind(attemptStderr);
            const shouldRetry = attempt < maxBrowserAttempts && derivedRetryableFailureKind !== null;
            if (shouldRetry) {
                flushAttemptCompileLogs(attemptCompileLogs, false);
                recordPersistentCompileLog(`[wasm-rust] browser rustc attempt ${attempt}/${maxBrowserAttempts} failed; retrying`, 'warn');
                emitCompileProgress('retry', Math.min(attempt + 1, maxBrowserAttempts), {
                    completed: Math.min(attempt + 1, maxBrowserAttempts),
                    total: maxBrowserAttempts,
                    message: `retrying browser rustc after attempt ${attempt}/${maxBrowserAttempts} failed`
                });
            }
            else {
                flushAttemptCompileLogs(attemptCompileLogs);
                return attachCompileLogs(attemptResult, readCompileLogs(), readCompileLogRecords());
            }
            await sleep(Math.min(500 * attempt, 2_000));
        }
        return attachCompileLogs(lastFailure, readCompileLogs(), readCompileLogRecords());
    }
    catch (error) {
        return makeFailure(error instanceof Error ? error.message : String(error));
    }
}
