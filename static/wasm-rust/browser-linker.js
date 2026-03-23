import { componentizeCoreWasmToPreview2Component } from './browser-component-tools.js';
import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { clearRuntimeAssetPackCache, loadRuntimePackEntries } from './runtime-asset-store.js';
import { resolveRuntimeAssetUrl } from './runtime-manifest.js';
const linkAssetCache = new Map();
function mkdirp(module, targetPath) {
    const segments = targetPath.replace(/^\/+/, '').split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
        current += '/' + segment;
        try {
            module.FS.mkdir(current);
        }
        catch { }
    }
}
function formatToolFailure(label, stage, stderr, stdout, detail) {
    const parts = [`${label} ${stage} failed`];
    if (detail) {
        parts.push(detail);
    }
    if (stderr.length > 0) {
        parts.push(`stderr=${stderr.join('\n')}`);
    }
    if (stdout.length > 0) {
        parts.push(`stdout=${stdout.join('\n')}`);
    }
    return new Error(parts.join(' | '));
}
export function clearLinkAssetCache() {
    linkAssetCache.clear();
    clearRuntimeAssetPackCache();
}
export async function linkBitcodeWithLlvmWasm(bitcode, manifest, target, runtimeBaseUrl, options = {}) {
    const loadRuntimeModule = options.importRuntimeModule ||
        ((assetUrl) => import(/* @vite-ignore */ assetUrl));
    const fetchImpl = options.fetchImpl || fetch;
    const componentizeCoreWasm = options.componentizeCoreWasm || componentizeCoreWasmToPreview2Component;
    const llcWasmAsset = target.compile.llvm.llcWasm || 'llvm/llc.wasm';
    const llcWasmUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, llcWasmAsset);
    let cachedLlcWasm = linkAssetCache.get(llcWasmUrl);
    if (!cachedLlcWasm) {
        cachedLlcWasm = fetchRuntimeAssetBytes(llcWasmUrl, `wasm-rust llvm asset ${llcWasmAsset}`, fetchImpl);
        linkAssetCache.set(llcWasmUrl, cachedLlcWasm);
        cachedLlcWasm.catch(() => {
            if (linkAssetCache.get(llcWasmUrl) === cachedLlcWasm) {
                linkAssetCache.delete(llcWasmUrl);
            }
        });
    }
    options.onProgress?.({
        stage: 'link',
        completed: 0,
        total: 2,
        message: 'running llvm-wasm code generation'
    });
    const { default: Llc } = await loadRuntimeModule(resolveRuntimeAssetUrl(runtimeBaseUrl, target.compile.llvm.llc));
    const llcStdout = [];
    const llcStderr = [];
    const llc = await Llc({
        locateFile(file) {
            if (file === 'llc.wasm') {
                return llcWasmUrl;
            }
            return resolveRuntimeAssetUrl(runtimeBaseUrl, `llvm/${file}`);
        },
        wasmBinary: await cachedLlcWasm,
        print(text) {
            llcStdout.push(String(text));
        },
        printErr(text) {
            llcStderr.push(String(text));
        }
    });
    mkdirp(llc, '/work');
    llc.FS.writeFile('/work/main.bc', bitcode);
    try {
        await llc.callMain(['-filetype=obj', '-o', '/work/main.o', '/work/main.bc']);
    }
    catch (error) {
        throw formatToolFailure('llc', 'codegen', llcStderr, llcStdout, error instanceof Error ? error.message : String(error));
    }
    let mainObject;
    try {
        mainObject = llc.FS.readFile('/work/main.o');
    }
    catch (error) {
        throw formatToolFailure('llc', 'output-read', llcStderr, llcStdout, error instanceof Error ? error.message : String(error));
    }
    options.onProgress?.({
        stage: 'link',
        completed: 1,
        total: 2,
        message: 'running lld link'
    });
    const lldWasmAsset = target.compile.llvm.lldWasm || 'llvm/lld.wasm';
    const lldWasmUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, lldWasmAsset);
    let cachedLldWasm = linkAssetCache.get(lldWasmUrl);
    if (!cachedLldWasm) {
        cachedLldWasm = fetchRuntimeAssetBytes(lldWasmUrl, `wasm-rust llvm asset ${lldWasmAsset}`, fetchImpl);
        linkAssetCache.set(lldWasmUrl, cachedLldWasm);
        cachedLldWasm.catch(() => {
            if (linkAssetCache.get(lldWasmUrl) === cachedLldWasm) {
                linkAssetCache.delete(lldWasmUrl);
            }
        });
    }
    const lldDataAsset = target.compile.llvm.lldData || 'llvm/lld.data';
    const lldDataUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, lldDataAsset);
    let cachedLldData = linkAssetCache.get(lldDataUrl);
    if (!cachedLldData) {
        cachedLldData = fetchRuntimeAssetBytes(lldDataUrl, `wasm-rust llvm asset ${lldDataAsset}`, fetchImpl);
        linkAssetCache.set(lldDataUrl, cachedLldData);
        cachedLldData.catch(() => {
            if (linkAssetCache.get(lldDataUrl) === cachedLldData) {
                linkAssetCache.delete(lldDataUrl);
            }
        });
    }
    const { default: Lld } = await loadRuntimeModule(resolveRuntimeAssetUrl(runtimeBaseUrl, target.compile.llvm.lld));
    const lldStdout = [];
    const lldStderr = [];
    const lldDataBytes = await cachedLldData;
    const lld = await Lld({
        locateFile(file) {
            if (file === 'lld.wasm') {
                return lldWasmUrl;
            }
            if (file === 'lld.data') {
                return lldDataUrl;
            }
            return resolveRuntimeAssetUrl(runtimeBaseUrl, `llvm/${file}`);
        },
        wasmBinary: await cachedLldWasm,
        getPreloadedPackage() {
            return new Uint8Array(lldDataBytes).buffer;
        },
        print(text) {
            lldStdout.push(String(text));
        },
        printErr(text) {
            lldStderr.push(String(text));
        }
    });
    const addFile = async (runtimePath, assetPath, contents) => {
        mkdirp(lld, runtimePath.split('/').slice(0, -1).join('/'));
        if (contents) {
            lld.FS.writeFile(runtimePath, contents);
            return;
        }
        const assetUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath);
        let cachedAsset = linkAssetCache.get(assetUrl);
        if (!cachedAsset) {
            cachedAsset = fetchRuntimeAssetBytes(assetUrl, `wasm-rust link asset ${assetPath}`, fetchImpl);
            linkAssetCache.set(assetUrl, cachedAsset);
            cachedAsset.catch(() => {
                if (linkAssetCache.get(assetUrl) === cachedAsset) {
                    linkAssetCache.delete(assetUrl);
                }
            });
        }
        lld.FS.writeFile(runtimePath, await cachedAsset);
    };
    await addFile('/work/main.o', '', mainObject);
    if (target.compile.link.pack) {
        for (const entry of await loadRuntimePackEntries(runtimeBaseUrl, target.compile.link.pack, fetchImpl)) {
            await addFile(entry.runtimePath, '', entry.bytes);
        }
    }
    else if (target.compile.link.allocatorObjectRuntimePath &&
        target.compile.link.allocatorObjectAsset &&
        target.compile.link.files) {
        const prefetchedAssets = new Map();
        const assetPrefetches = new Map();
        for (const assetPath of [
            target.compile.link.allocatorObjectAsset,
            ...target.compile.link.files.map((entry) => entry.asset)
        ]) {
            if (assetPrefetches.has(assetPath)) {
                continue;
            }
            assetPrefetches.set(assetPath, (async () => {
                const assetUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath);
                let cachedAsset = linkAssetCache.get(assetUrl);
                if (!cachedAsset) {
                    cachedAsset = fetchRuntimeAssetBytes(assetUrl, `wasm-rust link asset ${assetPath}`, fetchImpl);
                    linkAssetCache.set(assetUrl, cachedAsset);
                    cachedAsset.catch(() => {
                        if (linkAssetCache.get(assetUrl) === cachedAsset) {
                            linkAssetCache.delete(assetUrl);
                        }
                    });
                }
                const bytes = await cachedAsset;
                prefetchedAssets.set(assetPath, bytes);
                return bytes;
            })());
        }
        await Promise.all(assetPrefetches.values());
        await addFile(target.compile.link.allocatorObjectRuntimePath, target.compile.link.allocatorObjectAsset, prefetchedAssets.get(target.compile.link.allocatorObjectAsset));
        for (const entry of target.compile.link.files) {
            await addFile(entry.runtimePath, entry.asset, prefetchedAssets.get(entry.asset));
        }
    }
    else {
        throw new Error(`missing link runtime assets for target ${target.targetTriple}`);
    }
    try {
        await lld.callMain([...target.compile.link.args]);
    }
    catch (error) {
        throw formatToolFailure('lld', 'link', lldStderr, lldStdout, error instanceof Error ? error.message : String(error));
    }
    try {
        const coreWasm = lld.FS.readFile('/work/main.wasm');
        options.onProgress?.({
            stage: 'link',
            completed: 2,
            total: 2,
            message: 'llvm-wasm link finished'
        });
        if (target.compile.kind === 'llvm-wasm+component-encoder') {
            options.onProgress?.({
                stage: 'componentize',
                completed: 0,
                total: 1,
                message: 'encoding preview2 component'
            });
            const component = await componentizeCoreWasm(coreWasm, runtimeBaseUrl);
            options.onProgress?.({
                stage: 'componentize',
                completed: 1,
                total: 1,
                message: 'preview2 component ready'
            });
            return {
                wasm: component,
                targetTriple: target.targetTriple,
                format: 'component'
            };
        }
        return {
            wasm: coreWasm,
            targetTriple: target.targetTriple,
            format: target.artifactFormat
        };
    }
    catch (error) {
        throw formatToolFailure('lld', 'output-read', lldStderr, lldStdout, error instanceof Error ? error.message : String(error));
    }
}
