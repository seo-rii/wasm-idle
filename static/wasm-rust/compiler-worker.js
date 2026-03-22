import { resolveVersionedAssetUrl } from './asset-url.js';
import { createModuleWorker } from './module-worker.js';
import { resolveTargetManifest } from './runtime-manifest.js';
import { buildPreopenedDirectories, instantiateRustcInstance } from './rustc-runtime.js';
import { dispatchThreadPoolSlotAndWait, reserveIdleThreadPoolSlot, THREAD_STARTUP_STATE_INSTANTIATED } from './thread-startup.js';
import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { loadRuntimePackEntries } from './runtime-asset-store.js';
const ARCHIVE_MAGIC = new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]);
export function validateRuntimeAssetBytes(assetPath, bytes) {
    if (!assetPath.endsWith('.rlib') && !assetPath.endsWith('.a')) {
        return;
    }
    if (bytes.length >= ARCHIVE_MAGIC.length &&
        ARCHIVE_MAGIC.every((byte, index) => bytes[index] === byte)) {
        return;
    }
    const preview = new TextDecoder()
        .decode(bytes.slice(0, 64))
        .replaceAll(/\s+/g, ' ')
        .trim();
    throw new Error(`invalid wasm-rust runtime asset ${assetPath}: expected an ar archive but got ${JSON.stringify(preview || 'non-archive bytes')}. This usually means the browser loaded a stale or wrong wasm-rust bundle; hard refresh and resync the runtime assets.`);
}
export { fetchRuntimeAssetBytes };
function buildRustcArguments(request, manifest) {
    const edition = request.edition || '2024';
    const target = resolveTargetManifest(manifest, request.targetTriple);
    return [
        'rustc',
        '-Zthreads=1',
        '-Zcodegen-backend=llvm',
        ...(edition === '2024' ? ['-Zunstable-options'] : []),
        '/work/main.rs',
        '--sysroot',
        '/sysroot',
        '--target',
        target.targetTriple,
        '--crate-type',
        request.crateType || 'bin',
        '--edition',
        edition,
        '-Cpanic=abort',
        '-Ccodegen-units=1',
        '-Cno-prepopulate-passes',
        '-Csave-temps',
        '--emit=obj',
        '-o',
        '/work/main.o'
    ];
}
function emitCompileWorkerLog(request, message) {
    if (!request.request.log) {
        return;
    }
    postMessage({
        type: 'log',
        message
    });
}
function emitCompileWorkerProgress(request, progress) {
    postMessage({
        type: 'progress',
        progress
    });
}
async function compileRustInWorker(request) {
    const target = resolveTargetManifest(request.manifest, request.request.targetTriple);
    const threadPoolSize = 4;
    emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] start target=${target.targetTriple} timeout=${request.manifest.compiler.compileTimeoutMs}ms`);
    const rustcUrl = resolveVersionedAssetUrl(request.runtimeBaseUrl, request.manifest.compiler.rustcWasm);
    emitCompileWorkerProgress(request, {
        stage: 'fetch-rustc',
        completed: 0,
        total: 1,
        message: 'fetching rustc.wasm'
    });
    const rustcBytes = await fetchRuntimeAssetBytes(rustcUrl, 'rustc.wasm');
    emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] rustc.wasm fetched bytes=${rustcBytes.byteLength}`);
    emitCompileWorkerProgress(request, {
        stage: 'fetch-rustc',
        completed: 1,
        total: 1,
        message: 'rustc.wasm ready',
        bytesCompleted: rustcBytes.byteLength,
        bytesTotal: rustcBytes.byteLength
    });
    const rustcModule = await WebAssembly.compile(rustcBytes);
    let fetchedSysrootFiles = 0;
    let fetchedSysrootBytes = 0;
    const sysrootAssetTotal = target.sysrootPack?.fileCount || target.sysrootFiles?.length || 0;
    emitCompileWorkerProgress(request, {
        stage: 'fetch-sysroot',
        completed: 0,
        total: sysrootAssetTotal,
        message: target.sysrootPack
            ? `fetching ${sysrootAssetTotal} sysroot assets from pack`
            : `fetching ${sysrootAssetTotal} sysroot assets`,
        ...(target.sysrootPack
            ? {
                bytesTotal: target.sysrootPack.totalBytes
            }
            : {})
    });
    let sysrootAssets;
    if (target.sysrootPack) {
        const packedEntries = await loadRuntimePackEntries(request.runtimeBaseUrl, target.sysrootPack);
        sysrootAssets = packedEntries.map((entry) => {
            validateRuntimeAssetBytes(entry.runtimePath, entry.bytes);
            const sharedBuffer = new SharedArrayBuffer(entry.bytes.byteLength);
            new Uint8Array(sharedBuffer).set(entry.bytes);
            fetchedSysrootFiles += 1;
            fetchedSysrootBytes += entry.bytes.byteLength;
            emitCompileWorkerProgress(request, {
                stage: 'fetch-sysroot',
                completed: fetchedSysrootFiles,
                total: sysrootAssetTotal,
                message: `fetched sysroot asset ${entry.runtimePath}`,
                bytesCompleted: fetchedSysrootBytes,
                bytesTotal: target.sysrootPack?.totalBytes
            });
            if (request.request.log &&
                (fetchedSysrootFiles === 1 ||
                    fetchedSysrootFiles === sysrootAssetTotal ||
                    fetchedSysrootFiles % 100 === 0)) {
                emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] sysroot fetched ${fetchedSysrootFiles}/${sysrootAssetTotal} from pack`);
            }
            return {
                runtimePath: entry.runtimePath,
                buffer: sharedBuffer
            };
        });
    }
    else if (target.sysrootFiles) {
        sysrootAssets = await Promise.all(target.sysrootFiles.map(async (entry) => {
            const assetUrl = resolveVersionedAssetUrl(request.runtimeBaseUrl, entry.asset);
            const bytes = await fetchRuntimeAssetBytes(assetUrl, `wasm-rust sysroot asset ${entry.asset}`);
            validateRuntimeAssetBytes(entry.asset, bytes);
            const sharedBuffer = new SharedArrayBuffer(bytes.byteLength);
            new Uint8Array(sharedBuffer).set(bytes);
            fetchedSysrootFiles += 1;
            fetchedSysrootBytes += bytes.byteLength;
            emitCompileWorkerProgress(request, {
                stage: 'fetch-sysroot',
                completed: fetchedSysrootFiles,
                total: sysrootAssetTotal,
                message: `fetched sysroot asset ${entry.runtimePath}`,
                bytesCompleted: fetchedSysrootBytes
            });
            if (request.request.log &&
                (fetchedSysrootFiles === 1 ||
                    fetchedSysrootFiles === sysrootAssetTotal ||
                    fetchedSysrootFiles % 100 === 0)) {
                emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] sysroot fetched ${fetchedSysrootFiles}/${sysrootAssetTotal}`);
            }
            return {
                runtimePath: entry.runtimePath,
                buffer: sharedBuffer
            };
        }));
    }
    else {
        throw new Error(`missing sysroot assets for target ${target.targetTriple}`);
    }
    const memory = new WebAssembly.Memory({
        initial: request.manifest.compiler.rustcMemory.initialPages,
        maximum: request.manifest.compiler.rustcMemory.maximumPages,
        shared: true
    });
    emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] shared memory created initial=${request.manifest.compiler.rustcMemory.initialPages} max=${request.manifest.compiler.rustcMemory.maximumPages}`);
    emitCompileWorkerProgress(request, {
        stage: 'prepare-fs',
        completed: 0,
        total: 1,
        message: 'preparing in-memory filesystem'
    });
    const { fds, stdout, stderr } = await buildPreopenedDirectories(request.manifest, sysrootAssets, request.request.code, request.sharedBitcodeBuffer);
    emitCompileWorkerLog(request, '[wasm-rust:compiler-worker] preopened directories ready');
    emitCompileWorkerProgress(request, {
        stage: 'prepare-fs',
        completed: 1,
        total: 1,
        message: 'in-memory filesystem ready'
    });
    const args = buildRustcArguments(request.request, request.manifest);
    const threadCounter = new Int32Array(new SharedArrayBuffer(4));
    const slotBuffers = Array.from({ length: threadPoolSize }, () => new SharedArrayBuffer(16));
    let initializedThreadPoolSlots = 0;
    let reportedThreadFailure = false;
    const reportThreadFailure = (message) => {
        if (reportedThreadFailure)
            return;
        reportedThreadFailure = true;
        postMessage({
            type: 'error',
            message
        });
    };
    emitCompileWorkerProgress(request, {
        stage: 'init-thread-pool',
        completed: 0,
        total: threadPoolSize,
        message: `initializing ${threadPoolSize} helper threads`
    });
    const threadPool = await Promise.all(slotBuffers.map(async (slotBuffer, slotIndex) => {
        const slotState = new Int32Array(slotBuffer);
        Atomics.store(slotState, 0, -3);
        const threadWorkerUrl = resolveVersionedAssetUrl(import.meta.url, './rustc-thread-worker.js');
        if (request.request.log) {
            threadWorkerUrl.searchParams.set('log', '1');
        }
        const worker = createModuleWorker(threadWorkerUrl);
        worker.addEventListener('message', (event) => {
            if (event.data?.type !== 'thread-log') {
                return;
            }
            if (event.data.phase === 'pool-error' || event.data.phase === 'error') {
                if (request.request.log) {
                    emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] thread=${event.data.threadId} phase=${event.data.phase}${event.data.detail ? ` detail=${event.data.detail}` : ''}`);
                }
                reportThreadFailure(event.data.detail || `rustc browser helper thread ${event.data.threadId} failed`);
                return;
            }
            if (!request.request.log) {
                return;
            }
            emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] thread=${event.data.threadId} phase=${event.data.phase}${event.data.detail ? ` detail=${event.data.detail}` : ''}`);
        });
        worker.addEventListener('error', (event) => {
            emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] pool=${slotIndex} worker error ${event.message}`);
            reportThreadFailure(event.message || `rustc thread pool slot ${slotIndex} failed`);
            Atomics.store(slotState, 0, -1);
            Atomics.notify(slotState, 0);
        });
        worker.addEventListener('messageerror', () => {
            emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] pool=${slotIndex} worker messageerror during startup`);
            reportThreadFailure(`rustc thread pool slot ${slotIndex} messageerror during startup`);
            Atomics.store(slotState, 0, -1);
            Atomics.notify(slotState, 0);
        });
        worker.postMessage({
            type: 'thread-pool-init',
            runtimeBaseUrl: request.runtimeBaseUrl,
            manifest: request.manifest,
            sourceCode: request.request.code,
            log: Boolean(request.request.log),
            sharedBitcodeBuffer: request.sharedBitcodeBuffer,
            sharedStatusBuffer: request.sharedStatusBuffer,
            threadCounterBuffer: threadCounter.buffer,
            sysrootAssets,
            rustcModule,
            memory,
            args,
            slotIndex,
            slotBuffer,
            poolBuffers: slotBuffers
        });
        const initStartedAt = Date.now();
        while (Atomics.load(slotState, 0) === -3 && Date.now() - initStartedAt < 120_000) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (Atomics.load(slotState, 0) < 0) {
            throw new Error(`rustc thread pool slot ${slotIndex} failed to initialize`);
        }
        emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] pool=${slotIndex} initialized`);
        initializedThreadPoolSlots += 1;
        emitCompileWorkerProgress(request, {
            stage: 'init-thread-pool',
            completed: initializedThreadPoolSlots,
            total: threadPoolSize,
            message: `initialized helper thread slot ${slotIndex + 1}/${threadPoolSize}`
        });
        return {
            slotIndex,
            slotState
        };
    }));
    const threadSpawner = (startArg) => {
        const threadId = Atomics.add(threadCounter, 0, 1) + 1;
        const slot = reserveIdleThreadPoolSlot(threadPool);
        if (!slot) {
            throw new Error('rustc browser thread pool exhausted');
        }
        emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] assign thread=${threadId} startArg=${startArg} slot=${slot.slotIndex}`);
        dispatchThreadPoolSlotAndWait(slot.slotState, threadId, startArg, THREAD_STARTUP_STATE_INSTANTIATED, 30_000, `rustc browser helper thread ${threadId} failed before instantiating wasi_thread_start`, `rustc browser helper thread ${threadId} timed out before instantiating wasi_thread_start`);
        return threadId;
    };
    const instantiated = await instantiateRustcInstance({
        rustcModule,
        memory,
        args,
        fds,
        threadSpawner
    });
    emitCompileWorkerLog(request, '[wasm-rust:compiler-worker] rustc instance ready');
    const instance = instantiated.instance;
    let exitCode = null;
    try {
        emitCompileWorkerLog(request, '[wasm-rust:compiler-worker] starting rustc main');
        emitCompileWorkerProgress(request, {
            stage: 'rustc-main',
            completed: 0,
            total: 1,
            message: 'running rustc frontend'
        });
        exitCode = instantiated.wasiInstance.start(instance);
    }
    catch (error) {
        const stderrText = stderr.getText();
        postMessage({
            type: 'result',
            exitCode,
            stdout: stdout.getText(),
            stderr: stderrText +
                (error instanceof Error ? `${stderrText ? '\n' : ''}${error.message}` : '')
        });
        return;
    }
    emitCompileWorkerLog(request, `[wasm-rust:compiler-worker] rustc main exited code=${String(exitCode)}`);
    emitCompileWorkerProgress(request, {
        stage: 'rustc-main',
        completed: 1,
        total: 1,
        message: `rustc frontend finished with exit code ${String(exitCode)}`
    });
    postMessage({
        type: 'result',
        exitCode,
        stdout: stdout.getText(),
        stderr: stderr.getText()
    });
}
if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('message', (event) => {
        if (event.data?.type !== 'compile') {
            return;
        }
        void compileRustInWorker(event.data).catch((error) => {
            emitCompileWorkerLog(event.data, `[wasm-rust:compiler-worker] unhandled failure ${error instanceof Error ? error.message : String(error)}`);
            postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error)
            });
        });
    });
}
