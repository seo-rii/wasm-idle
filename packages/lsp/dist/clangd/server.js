import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import { CLANGD_ASSETS, loadLanguageToolAsset } from '../assets.js';
import { resolveCppLanguageServerRuntimeAssetConfig } from '../runtime.js';
import { createLanguageServerProgressReporter } from '../worker-client.js';
const currentUrl = () => globalThis.location?.href || '';
const createDefaultClangdWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
function isClangdLanguageServerOptions(options) {
    return typeof options === 'object' && !!options;
}
function transferBuffer(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
async function preloadClangdAssets(assetConfig, onStatus) {
    if (!assetConfig.loader)
        return undefined;
    const fractions = new Map();
    for (const asset of CLANGD_ASSETS)
        fractions.set(asset, 0);
    const emitProgress = () => {
        let loaded = 0;
        for (const fraction of fractions.values())
            loaded += fraction;
        onStatus?.({ state: 'loading', loaded: loaded / fractions.size, total: 1 });
    };
    const load = async (asset) => {
        const loaded = await loadLanguageToolAsset('clangd', asset, assetConfig, (value, total) => {
            fractions.set(asset, total && total > 0 ? Math.min(value / total, 1) : value > 0 ? 1 : 0);
            emitProgress();
        });
        return transferBuffer(loaded.bytes);
    };
    const clangdJs = await load('clangd.js');
    const clangdWasmGz = await load('clangd.wasm.gz');
    return {
        assets: { clangdJs, clangdWasmGz },
        transfer: [clangdJs, clangdWasmGz]
    };
}
async function createServer(assetConfig, createWorker, onStatus, debug = false) {
    const status = createLanguageServerProgressReporter(onStatus);
    status.loading();
    const preloaded = await preloadClangdAssets(assetConfig, onStatus);
    let resolveReady = () => { };
    let rejectReady = (_error) => { };
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const worker = createWorker();
    const cleanup = () => {
        worker.removeEventListener('message', readyListener);
        worker.removeEventListener('error', errorListener);
    };
    const readyListener = (event) => {
        switch (event.data?.type) {
            case 'progress': {
                status.progress({ loaded: event.data.value, total: event.data.max });
                break;
            }
            case 'ready': {
                cleanup();
                status.ready();
                resolveReady();
                break;
            }
            case 'error': {
                cleanup();
                rejectReady(new Error(event.data?.message || 'clangd failed to initialize'));
                break;
            }
        }
    };
    const errorListener = (event) => {
        cleanup();
        rejectReady(event.error || new Error(event.message || 'clangd worker failed'));
    };
    worker.addEventListener('message', readyListener);
    worker.addEventListener('error', errorListener);
    worker.postMessage({
        type: 'init',
        baseUrl: assetConfig.baseUrl,
        ...(debug ? { debug } : {}),
        ...(preloaded ? { assets: preloaded.assets } : {})
    }, preloaded?.transfer || []);
    await ready;
    return worker;
}
export async function createClangdLanguageServer(options) {
    const hostOptions = isClangdLanguageServerOptions(options) ? options : undefined;
    const current = hostOptions?.currentUrl ?? currentUrl();
    const assetConfig = resolveCppLanguageServerRuntimeAssetConfig(options, current);
    const debug = (() => {
        try {
            return new URL(current).searchParams.get('lsp-test') === '1';
        }
        catch {
            return false;
        }
    })();
    const worker = await createServer(assetConfig, hostOptions?.createWorker || createDefaultClangdWorker, hostOptions?.onStatus, debug);
    const reader = new BrowserMessageReader(worker);
    const writer = new BrowserMessageWriter(worker);
    return {
        transport: { reader, writer },
        syncFile: (path) => {
            worker.postMessage({ type: 'sync-file', name: path });
        },
        dispose: () => {
            worker.terminate();
            reader.dispose();
            writer.dispose();
            hostOptions?.onStatus?.({ state: 'disabled' });
        }
    };
}
export const getCppLanguageServer = createClangdLanguageServer;
//# sourceMappingURL=server.js.map