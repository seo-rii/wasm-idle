import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { resolveRuntimeAssetUrl } from './runtime-manifest.js';
export const JCO_BROWSER_MODULE = '../vendor/jco/src/browser.js';
export const JCO_WASM_TOOLS_MODULE = '../vendor/jco/obj/wasm-tools.js';
export const PREVIEW1_COMMAND_ADAPTER = '../vendor/jco/lib/wasi_snapshot_preview1.command.wasm';
export const PREVIEW2_CLI_MODULE = '../vendor/preview2-shim/lib/browser/cli.js';
export const PREVIEW2_CLOCKS_MODULE = '../vendor/preview2-shim/lib/browser/clocks.js';
export const PREVIEW2_FILESYSTEM_MODULE = '../vendor/preview2-shim/lib/browser/filesystem.js';
export const PREVIEW2_HTTP_MODULE = '../vendor/preview2-shim/lib/browser/http.js';
export const PREVIEW2_IO_MODULE = '../vendor/preview2-shim/lib/browser/io.js';
export const PREVIEW2_RANDOM_MODULE = '../vendor/preview2-shim/lib/browser/random.js';
export const PREVIEW2_SOCKETS_MODULE = '../vendor/preview2-shim/lib/browser/sockets.js';
export const PREVIEW2_COMPONENT_RUNTIME_ASSETS = [
    JCO_BROWSER_MODULE,
    JCO_WASM_TOOLS_MODULE,
    PREVIEW1_COMMAND_ADAPTER,
    PREVIEW2_CLI_MODULE,
    PREVIEW2_CLOCKS_MODULE,
    PREVIEW2_FILESYSTEM_MODULE,
    PREVIEW2_HTTP_MODULE,
    PREVIEW2_IO_MODULE,
    PREVIEW2_RANDOM_MODULE,
    PREVIEW2_SOCKETS_MODULE
];
const symbolDispose = Symbol.dispose ?? Symbol.for('dispose');
async function importRuntimeModule(runtimeBaseUrl, assetPath) {
    return (await import(
    /* @vite-ignore */ resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath)));
}
export async function componentizeCoreWasmToPreview2Component(coreWasm, runtimeBaseUrl) {
    const wasmToolsModule = await importRuntimeModule(runtimeBaseUrl, JCO_WASM_TOOLS_MODULE);
    const adapterUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, PREVIEW1_COMMAND_ADAPTER);
    const adapterBytes = await fetchRuntimeAssetBytes(adapterUrl, 'wasm-rust preview1 adapter');
    await wasmToolsModule.$init;
    return wasmToolsModule.tools.componentNew(coreWasm, [['wasi_snapshot_preview1', adapterBytes]]);
}
export async function transpilePreview2Component(componentBytes, runtimeBaseUrl, name = 'component') {
    const browserModule = await importRuntimeModule(runtimeBaseUrl, JCO_BROWSER_MODULE);
    const generated = await browserModule.generate(componentBytes, {
        name,
        instantiation: { tag: 'async' },
        noTypescript: true,
        noNodejsCompat: true,
        map: []
    });
    return {
        files: new Map(generated.files),
        imports: generated.imports,
        exports: generated.exports
    };
}
export async function createPreview2ImportObject(runtimeBaseUrl, options = {}, dependencies = {}) {
    const loadModule = dependencies.importRuntimeModule || importRuntimeModule;
    let cliModule = null;
    let filesystemModule = null;
    let ioModule = null;
    let randomModule = null;
    let clocksModule = null;
    let socketsModule = null;
    let httpModule = null;
    const requestedVersionSuffixes = new Set(['', '@0.2.3']);
    const requiredFamilies = new Set();
    if (options.requiredImports && options.requiredImports.length > 0) {
        for (const requestedImport of options.requiredImports) {
            const versionMatch = requestedImport.match(/(@.+)$/);
            if (versionMatch) {
                if (!/^@0\.2(?:\.|$)/.test(versionMatch[1])) {
                    throw new Error(`wasm-rust browser runtime currently provides only WASIp2 browser shims; unsupported component import ${requestedImport}. wasm32-wasip3 works in-browser only while emitted components stay on transitional WASIp2 imports.`);
                }
                requestedVersionSuffixes.add(versionMatch[1]);
            }
            const normalizedImport = requestedImport.replace(/@\d+(?:\.\d+)*$/, '');
            if (normalizedImport.startsWith('wasi:cli/')) {
                requiredFamilies.add('cli');
                continue;
            }
            if (normalizedImport.startsWith('wasi:filesystem/')) {
                requiredFamilies.add('filesystem');
                continue;
            }
            if (normalizedImport.startsWith('wasi:io/')) {
                requiredFamilies.add('io');
                continue;
            }
            if (normalizedImport.startsWith('wasi:random/')) {
                requiredFamilies.add('random');
                continue;
            }
            if (normalizedImport.startsWith('wasi:clocks/')) {
                requiredFamilies.add('clocks');
                continue;
            }
            if (normalizedImport.startsWith('wasi:sockets/')) {
                requiredFamilies.add('sockets');
                continue;
            }
            if (normalizedImport.startsWith('wasi:http/')) {
                requiredFamilies.add('http');
            }
        }
    }
    if (requiredFamilies.size === 0) {
        requiredFamilies.add('cli');
        requiredFamilies.add('filesystem');
        requiredFamilies.add('io');
        requiredFamilies.add('random');
        requiredFamilies.add('clocks');
        requiredFamilies.add('sockets');
        requiredFamilies.add('http');
    }
    const moduleLoads = [];
    if (requiredFamilies.has('cli')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_CLI_MODULE).then((module) => {
            cliModule = module;
        }));
    }
    if (requiredFamilies.has('filesystem')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_FILESYSTEM_MODULE).then((module) => {
            filesystemModule = module;
        }));
    }
    if (requiredFamilies.has('io')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_IO_MODULE).then((module) => {
            ioModule = module;
        }));
    }
    if (requiredFamilies.has('random')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_RANDOM_MODULE).then((module) => {
            randomModule = module;
        }));
    }
    if (requiredFamilies.has('clocks')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_CLOCKS_MODULE).then((module) => {
            clocksModule = module;
        }));
    }
    if (requiredFamilies.has('sockets')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_SOCKETS_MODULE).then((module) => {
            socketsModule = module;
        }));
    }
    if (requiredFamilies.has('http')) {
        moduleLoads.push(loadModule(runtimeBaseUrl, PREVIEW2_HTTP_MODULE).then((module) => {
            httpModule = module;
        }));
    }
    await Promise.all(moduleLoads);
    if (!cliModule) {
        throw new Error('preview2 cli shim is required to create a runnable import object');
    }
    const resolvedCliModule = cliModule;
    const resolvedFilesystemModule = filesystemModule;
    const resolvedIoModule = ioModule;
    const resolvedRandomModule = randomModule;
    const resolvedClocksModule = clocksModule;
    const resolvedSocketsModule = socketsModule;
    const resolvedHttpModule = httpModule;
    if (options.stdin) {
        resolvedCliModule._setStdin({
            blockingRead(contents) {
                return options.stdin?.blockingRead(Number(contents)) || new Uint8Array(0);
            },
            [symbolDispose]() { }
        });
    }
    if (options.stdout) {
        resolvedCliModule._setStdout({
            write(contents) {
                options.stdout?.(contents);
                return BigInt(contents.byteLength);
            },
            blockingFlush() { }
        });
    }
    if (options.stderr) {
        resolvedCliModule._setStderr({
            write(contents) {
                options.stderr?.(contents);
                return BigInt(contents.byteLength);
            },
            blockingFlush() { }
        });
    }
    const importObject = {};
    const environment = {
        ...resolvedCliModule.environment,
        getEnvironment() {
            return options.env
                ? Object.entries(options.env)
                : resolvedCliModule.environment.getEnvironment();
        },
        getArguments() {
            return options.args || ['component.wasm'];
        },
        initialCwd() {
            return resolvedCliModule.environment.initialCwd();
        }
    };
    const preopens = resolvedFilesystemModule === null
        ? null
        : {
            Descriptor: resolvedFilesystemModule.types.Descriptor,
            getDirectories() {
                return [];
            }
        };
    for (const versionSuffix of requestedVersionSuffixes) {
        if (requiredFamilies.has('cli')) {
            importObject[`wasi:cli/environment${versionSuffix}`] = environment;
            importObject[`wasi:cli/exit${versionSuffix}`] = resolvedCliModule.exit;
            importObject[`wasi:cli/stderr${versionSuffix}`] = resolvedCliModule.stderr;
            importObject[`wasi:cli/stdin${versionSuffix}`] = resolvedCliModule.stdin;
            importObject[`wasi:cli/stdout${versionSuffix}`] = resolvedCliModule.stdout;
            importObject[`wasi:cli/terminal-input${versionSuffix}`] = resolvedCliModule.terminalInput;
            importObject[`wasi:cli/terminal-output${versionSuffix}`] = resolvedCliModule.terminalOutput;
            importObject[`wasi:cli/terminal-stderr${versionSuffix}`] = resolvedCliModule.terminalStderr;
            importObject[`wasi:cli/terminal-stdin${versionSuffix}`] = resolvedCliModule.terminalStdin;
            importObject[`wasi:cli/terminal-stdout${versionSuffix}`] = resolvedCliModule.terminalStdout;
        }
        if (requiredFamilies.has('filesystem') && resolvedFilesystemModule && preopens) {
            importObject[`wasi:filesystem/preopens${versionSuffix}`] = preopens;
            importObject[`wasi:filesystem/types${versionSuffix}`] = resolvedFilesystemModule.types;
        }
        if (requiredFamilies.has('io') && resolvedIoModule) {
            importObject[`wasi:io/error${versionSuffix}`] = resolvedIoModule.error;
            importObject[`wasi:io/poll${versionSuffix}`] = resolvedIoModule.poll;
            importObject[`wasi:io/streams${versionSuffix}`] = resolvedIoModule.streams;
        }
        if (requiredFamilies.has('random') && resolvedRandomModule) {
            importObject[`wasi:random/random${versionSuffix}`] = resolvedRandomModule.random;
            importObject[`wasi:random/insecure${versionSuffix}`] = resolvedRandomModule.insecure;
            importObject[`wasi:random/insecure-seed${versionSuffix}`] = resolvedRandomModule.insecureSeed;
        }
        if (requiredFamilies.has('clocks') && resolvedClocksModule) {
            importObject[`wasi:clocks/monotonic-clock${versionSuffix}`] = resolvedClocksModule.monotonicClock;
            importObject[`wasi:clocks/wall-clock${versionSuffix}`] = resolvedClocksModule.wallClock;
        }
        if (requiredFamilies.has('sockets') && resolvedSocketsModule) {
            importObject[`wasi:sockets/instance-network${versionSuffix}`] = resolvedSocketsModule.instanceNetwork;
            importObject[`wasi:sockets/ip-name-lookup${versionSuffix}`] = resolvedSocketsModule.ipNameLookup;
            importObject[`wasi:sockets/network${versionSuffix}`] = resolvedSocketsModule.network;
            importObject[`wasi:sockets/tcp${versionSuffix}`] = resolvedSocketsModule.tcp;
            importObject[`wasi:sockets/tcp-create-socket${versionSuffix}`] = resolvedSocketsModule.tcpCreateSocket;
            importObject[`wasi:sockets/udp${versionSuffix}`] = resolvedSocketsModule.udp;
            importObject[`wasi:sockets/udp-create-socket${versionSuffix}`] = resolvedSocketsModule.udpCreateSocket;
        }
        if (requiredFamilies.has('http') && resolvedHttpModule) {
            importObject[`wasi:http/types${versionSuffix}`] = resolvedHttpModule.types;
            importObject[`wasi:http/outgoing-handler${versionSuffix}`] = resolvedHttpModule.outgoingHandler;
        }
    }
    return importObject;
}
