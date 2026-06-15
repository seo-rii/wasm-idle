import { generate } from './vendor/jco/src/browser.js';
import { _setArgs, _setCwd, _setEnv, _setStderr, _setStdin, _setStdout, environment, exit, stderr, stdin, stdout } from './vendor/preview2-shim/lib/browser/cli.js';
import { monotonicClock, wallClock } from './vendor/preview2-shim/lib/browser/clocks.js';
import { _setFileData, preopens, types } from './vendor/preview2-shim/lib/browser/filesystem.js';
import { error, poll, streams } from './vendor/preview2-shim/lib/browser/io.js';
import { insecure, insecureSeed, random } from './vendor/preview2-shim/lib/browser/random.js';
const encoder = new TextEncoder();
const decoderFatal = new TextDecoder();
const symbolDispose = Symbol.dispose ?? Symbol.for('dispose');
const outputFileName = '__wasm_idle_output.wasm';
class BufferedInput {
    source;
    chunk = new Uint8Array(0);
    offset = 0;
    constructor(source) {
        this.source = source;
    }
    read(length) {
        if (this.offset >= this.chunk.byteLength) {
            const next = this.source?.() ?? null;
            if (next === null) {
                this.chunk = new Uint8Array(0);
                this.offset = 0;
                return this.chunk;
            }
            this.chunk =
                typeof next === 'string'
                    ? encoder.encode(next)
                    : next instanceof Uint8Array
                        ? next
                        : new Uint8Array(next);
            this.offset = 0;
        }
        const end = Math.min(this.offset + length, this.chunk.byteLength);
        const data = this.chunk.slice(this.offset, end);
        this.offset = end;
        return data;
    }
}
function normalizeRuntimeBaseUrl(value) {
    const baseUrl = value
        ? new URL(String(value), import.meta.url)
        : new URL('./', import.meta.url);
    return baseUrl.href.endsWith('/') ? baseUrl : new URL('./', baseUrl.href);
}
function normalizeWorkspacePath(value, fallback = 'main.scm') {
    const normalized = (value || '')
        .trim()
        .replaceAll('\\', '/')
        .split('/')
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
    return normalized || fallback;
}
function bytesFromContent(content) {
    return typeof content === 'string' ? encoder.encode(content) : content;
}
function addFile(root, filePath, content) {
    const parts = normalizeWorkspacePath(filePath).split('/');
    let current = root;
    for (const part of parts.slice(0, -1)) {
        current.dir ||= {};
        current.dir[part] ||= { dir: {} };
        current = current.dir[part];
        current.dir ||= {};
    }
    current.dir ||= {};
    current.dir[parts.at(-1) || 'main.scm'] = { source: bytesFromContent(content) };
}
function buildWorkspaceFileData(code, activePath, files = []) {
    const root = { dir: { workspace: { dir: {} } } };
    const workspace = root.dir?.workspace;
    if (!workspace)
        return root;
    for (const file of files) {
        if (!file || typeof file.path !== 'string')
            continue;
        addFile(workspace, file.path, file.path === activePath ? code : file.content);
    }
    addFile(workspace, activePath, code);
    return root;
}
function getWorkspaceFile(root, filePath) {
    const parts = ['workspace', ...normalizeWorkspacePath(filePath).split('/')];
    let current = root;
    for (const part of parts) {
        current = current?.dir?.[part];
    }
    return current?.source instanceof Uint8Array ? current.source : null;
}
function isExitError(errorValue) {
    return (!!errorValue &&
        typeof errorValue === 'object' &&
        'exitError' in errorValue &&
        'code' in errorValue);
}
function makeDiagnostic(message, fileName, lineNumber = 1) {
    return {
        fileName,
        lineNumber,
        severity: 'error',
        message: message || 'Scheme compilation failed'
    };
}
function setupWasiShims(options) {
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdoutText = '';
    let stderrText = '';
    const input = new BufferedInput(options.stdin);
    _setArgs(options.args || ['component.wasm']);
    _setEnv(options.env || {});
    _setCwd('/workspace');
    _setFileData(options.fileData);
    _setStdin({
        blockingRead(length) {
            return input.read(Number(length));
        },
        subscribe() { },
        [symbolDispose]() { }
    });
    _setStdout({
        write(contents) {
            const chunk = stdoutDecoder.decode(contents, { stream: true });
            stdoutText += chunk;
            options.stdout?.(chunk);
            return BigInt(contents.byteLength);
        },
        blockingFlush() { }
    });
    _setStderr({
        write(contents) {
            const chunk = stderrDecoder.decode(contents, { stream: true });
            stderrText += chunk;
            options.stderr?.(chunk);
            return BigInt(contents.byteLength);
        },
        blockingFlush() { }
    });
    return {
        imports: {
            'wasi:cli/environment': environment,
            'wasi:cli/exit': exit,
            'wasi:cli/stderr': stderr,
            'wasi:cli/stdin': stdin,
            'wasi:cli/stdout': stdout,
            'wasi:clocks/monotonic-clock': monotonicClock,
            'wasi:clocks/wall-clock': wallClock,
            'wasi:filesystem/preopens': preopens,
            'wasi:filesystem/types': types,
            'wasi:io/error': error,
            'wasi:io/poll': poll,
            'wasi:io/streams': streams,
            'wasi:random/insecure': insecure,
            'wasi:random/insecure-seed': insecureSeed,
            'wasi:random/random': random
        },
        finish() {
            const trailingStdout = stdoutDecoder.decode();
            if (trailingStdout) {
                stdoutText += trailingStdout;
                options.stdout?.(trailingStdout);
            }
            const trailingStderr = stderrDecoder.decode();
            if (trailingStderr) {
                stderrText += trailingStderr;
                options.stderr?.(trailingStderr);
            }
            return {
                stdout: stdoutText,
                stderr: stderrText
            };
        }
    };
}
async function fetchBytes(url, fetcher) {
    const response = await fetcher(url.href);
    if (!response.ok) {
        throw new Error(`failed to load ${url.href}: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
function toBase64(bytes) {
    const bufferCtor = globalThis.Buffer;
    if (bufferCtor)
        return bufferCtor.from(bytes).toString('base64');
    let binary = '';
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
        const chunk = bytes.subarray(offset, offset + 0x8000);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
function createGeneratedModuleUrl(source) {
    if (typeof document !== 'undefined' &&
        typeof Blob !== 'undefined' &&
        typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript;charset=utf-8' }));
        return {
            url,
            revoke() {
                URL.revokeObjectURL(url);
            }
        };
    }
    return {
        url: `data:text/javascript;base64,${toBase64(encoder.encode(source))}`,
        revoke() { }
    };
}
function findRunExport(instance) {
    const runExport = instance.run ||
        instance['wasi:cli/run@0.2.0'] ||
        Object.values(instance).find((value) => value && typeof value === 'object' && typeof value.run === 'function');
    if (!runExport || typeof runExport.run !== 'function') {
        throw new Error('WASM component is missing a runnable wasi:cli/run export');
    }
    return runExport;
}
async function runComponentModule(module, getCoreModule, imports) {
    const instance = await module.instantiate(getCoreModule, imports);
    const runExport = findRunExport(instance);
    let exitCode = 0;
    try {
        await runExport.run();
    }
    catch (errorValue) {
        if (!isExitError(errorValue))
            throw errorValue;
        exitCode = Number(errorValue.code);
    }
    return exitCode;
}
async function instantiateGeneratedComponent(componentBytes, name, imports) {
    const generated = await generate(componentBytes, {
        name,
        instantiation: { tag: 'async' },
        noTypescript: true,
        noNodejsCompat: true,
        map: []
    });
    const missingImports = generated.imports.filter((specifier) => !(specifier in imports));
    if (missingImports.length > 0) {
        throw new Error(`unsupported Scheme component imports: ${missingImports.join(', ')}`);
    }
    const files = new Map(generated.files);
    const entryName = Array.from(files.keys()).find((fileName) => fileName.endsWith('.js'));
    if (!entryName)
        throw new Error('JCO did not generate a JavaScript entry file');
    const entryFile = files.get(entryName);
    if (!entryFile)
        throw new Error(`JCO generated a missing entry file: ${entryName}`);
    const entrySource = decoderFatal.decode(entryFile);
    const entryUrl = createGeneratedModuleUrl(entrySource);
    try {
        const componentModule = (await import(/* @vite-ignore */ entryUrl.url));
        return await runComponentModule(componentModule, async (moduleName) => {
            const normalizedName = moduleName.replace(/^[./]+/, '');
            const moduleBytes = files.get(normalizedName) || files.get(moduleName);
            if (!moduleBytes) {
                throw new Error(`missing generated Scheme core module ${moduleName}`);
            }
            return WebAssembly.compile(new Uint8Array(moduleBytes));
        }, imports);
    }
    finally {
        entryUrl.revoke();
    }
}
export async function createLispCompiler(options = {}) {
    const runtimeBaseUrl = normalizeRuntimeBaseUrl(options.runtimeBaseUrl);
    const fetcher = options.fetch || globalThis.fetch?.bind(globalThis);
    if (!fetcher) {
        throw new Error('wasm-lisp requires fetch to load the Puppy Scheme compiler assets');
    }
    const compilerModuleUrl = new URL('puppyc.js', runtimeBaseUrl);
    const compilerModulePromise = import(
    /* @vite-ignore */ compilerModuleUrl.href);
    const coreModuleCache = new Map();
    async function getCompilerCoreModule(moduleName) {
        const normalizedName = moduleName.replace(/^[./]+/, '');
        const moduleUrl = new URL(normalizedName, runtimeBaseUrl);
        const key = moduleUrl.href;
        if (!coreModuleCache.has(key)) {
            coreModuleCache.set(key, fetchBytes(moduleUrl, fetcher).then((bytes) => WebAssembly.compile(bytes)));
        }
        return await coreModuleCache.get(key);
    }
    return {
        async compile(request) {
            const fileName = normalizeWorkspacePath(request.fileName, 'main.scm');
            const outputPath = outputFileName;
            const fileData = buildWorkspaceFileData(request.code, fileName, request.files);
            const wasi = setupWasiShims({
                args: ['puppyc.wasm', '-o', `/workspace/${outputPath}`, `/workspace/${fileName}`],
                env: {},
                fileData
            });
            let exitCode = 0;
            try {
                exitCode = await runComponentModule(await compilerModulePromise, getCompilerCoreModule, wasi.imports);
            }
            catch (errorValue) {
                const output = wasi.finish();
                const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
                return {
                    success: false,
                    diagnostics: [makeDiagnostic(output.stderr || message, fileName)],
                    stdout: output.stdout,
                    stderr: output.stderr || message
                };
            }
            const output = wasi.finish();
            const component = getWorkspaceFile(fileData, outputPath);
            const success = exitCode === 0 && !!component;
            return {
                success,
                ...(success
                    ? {
                        artifact: {
                            component,
                            format: 'component',
                            source: request.code,
                            fileName,
                            compiler: 'puppy-scheme'
                        }
                    }
                    : {}),
                diagnostics: success
                    ? []
                    : [
                        makeDiagnostic(output.stderr ||
                            output.stdout ||
                            `Puppy Scheme compiler exited with code ${exitCode}`, fileName)
                    ],
                stdout: output.stdout,
                stderr: output.stderr
            };
        }
    };
}
export async function executeBrowserLispArtifact(artifact, options = {}) {
    if (!artifact?.component) {
        throw new Error('wasm-lisp artifact is missing component bytes');
    }
    const activePath = normalizeWorkspacePath(options.activePath || artifact.fileName, 'main.scm');
    const fileData = buildWorkspaceFileData(artifact.source || '', activePath, options.files);
    const wasi = setupWasiShims({
        args: ['main.wasm', ...(options.args || [])],
        env: options.env,
        fileData,
        stdin: options.stdin,
        stdout: options.stdout,
        stderr: options.stderr
    });
    let exitCode = 0;
    try {
        exitCode = await instantiateGeneratedComponent(artifact.component, 'wasm_lisp_program', wasi.imports);
    }
    catch (errorValue) {
        const output = wasi.finish();
        if (isExitError(errorValue)) {
            return {
                exitCode: Number(errorValue.code),
                stdout: output.stdout,
                stderr: output.stderr
            };
        }
        throw errorValue;
    }
    const output = wasi.finish();
    return {
        exitCode,
        stdout: output.stdout,
        stderr: output.stderr
    };
}
export default createLispCompiler;
