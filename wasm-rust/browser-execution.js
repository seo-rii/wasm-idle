import { Fd, Inode } from './vendor/browser_wasi_shim/fd.js';
import { PreopenDirectory } from './vendor/browser_wasi_shim/fs_mem.js';
import WASI from './vendor/browser_wasi_shim/wasi.js';
import * as wasi from './vendor/browser_wasi_shim/wasi_defs.js';
import { createPreview2ImportObject, transpilePreview2Component } from './browser-component-tools.js';
function toStandaloneBytes(value) {
    const source = value instanceof Uint8Array ? value : new Uint8Array(value);
    return new Uint8Array(source);
}
function toTextBytes(value) {
    if (typeof value === 'string') {
        return new TextEncoder().encode(value);
    }
    return toStandaloneBytes(value);
}
class CaptureFd extends Fd {
    ino = Inode.issue_ino();
    decoder = new TextDecoder();
    chunks = [];
    output;
    constructor(output) {
        super();
        this.output = output;
    }
    fd_filestat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
        };
    }
    fd_fdstat_get() {
        const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
        fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
        return {
            ret: wasi.ERRNO_SUCCESS,
            fdstat
        };
    }
    fd_write(data) {
        const chunk = this.decoder.decode(data, { stream: true });
        this.chunks.push(chunk);
        this.output?.(chunk);
        return {
            ret: wasi.ERRNO_SUCCESS,
            nwritten: data.byteLength
        };
    }
    append(data) {
        const chunk = this.decoder.decode(data, { stream: true });
        this.chunks.push(chunk);
        this.output?.(chunk);
    }
    getText() {
        const trailing = this.decoder.decode();
        if (trailing) {
            this.chunks.push(trailing);
            this.output?.(trailing);
        }
        return this.chunks.join('');
    }
}
class BufferedExecutionInput {
    currentChunk = new Uint8Array(0);
    currentOffset = 0;
    readInput;
    constructor(readInput) {
        this.readInput = readInput;
    }
    read(size) {
        while (this.currentOffset >= this.currentChunk.length) {
            const nextChunk = this.readInput?.();
            if (nextChunk == null) {
                return new Uint8Array(0);
            }
            this.currentChunk = toTextBytes(nextChunk);
            this.currentOffset = 0;
            if (this.currentChunk.byteLength === 0) {
                continue;
            }
        }
        const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
        this.currentOffset += data.byteLength;
        return data;
    }
}
class StdinFd extends Fd {
    ino = Inode.issue_ino();
    source;
    constructor(source) {
        super();
        this.source = source;
    }
    fd_filestat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
        };
    }
    fd_fdstat_get() {
        const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
        fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
        return {
            ret: wasi.ERRNO_SUCCESS,
            fdstat
        };
    }
    fd_read(size) {
        return {
            ret: wasi.ERRNO_SUCCESS,
            data: this.source.read(size)
        };
    }
}
async function runPreview1WasiModule(wasmArtifact, options = {}) {
    const bytes = toStandaloneBytes(wasmArtifact);
    const stdin = new BufferedExecutionInput(options.stdin);
    const stdout = new CaptureFd(options.stdout);
    const stderr = new CaptureFd(options.stderr);
    const wasiInstance = new WASI(['main.wasm', ...(options.args || [])], Object.entries(options.env || {}).map(([key, value]) => `${key}=${value}`), [
        new StdinFd(stdin),
        stdout,
        stderr,
        new PreopenDirectory('/tmp', new Map())
    ]);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiInstance.wasiImport
    });
    const exitCode = wasiInstance.start(instance);
    return {
        exitCode,
        stdout: stdout.getText(),
        stderr: stderr.getText()
    };
}
async function runPreview2Component(componentBytes, runtimeBaseUrl, options = {}) {
    const bytes = toStandaloneBytes(componentBytes);
    const stdin = new BufferedExecutionInput(options.stdin);
    const stdout = new CaptureFd(options.stdout);
    const stderr = new CaptureFd(options.stderr);
    const transpiled = await transpilePreview2Component(bytes, runtimeBaseUrl, 'wasm-rust-component');
    const entryName = Array.from(transpiled.files.keys()).find((name) => name.endsWith('.js'));
    if (!entryName) {
        throw new Error('jco transpile did not generate a JavaScript entry file');
    }
    const entrySource = new TextDecoder().decode(transpiled.files.get(entryName));
    const entryUrl = URL.createObjectURL(new Blob([entrySource], { type: 'text/javascript;charset=utf-8' }));
    const imports = await createPreview2ImportObject(runtimeBaseUrl, {
        args: ['component.wasm', ...(options.args || [])],
        env: options.env,
        requiredImports: transpiled.imports,
        stdin: {
            blockingRead(length) {
                return stdin.read(length);
            }
        },
        stdout: (chunk) => stdout.append(chunk),
        stderr: (chunk) => stderr.append(chunk)
    });
    try {
        const componentModule = (await import(
        /* @vite-ignore */ entryUrl));
        const instantiated = await componentModule.instantiate(async (name) => {
            const normalizedName = name.replace(/^[./]+/, '');
            const moduleBytes = transpiled.files.get(normalizedName) || transpiled.files.get(name);
            if (!moduleBytes) {
                throw new Error(`missing transpiled preview2 core module ${name}`);
            }
            return WebAssembly.compile(new Uint8Array(moduleBytes));
        }, imports);
        const runExport = instantiated.run ||
            instantiated['wasi:cli/run@0.2.3'] ||
            Object.values(instantiated).find((value) => value && typeof value === 'object' && typeof value.run === 'function');
        if (!runExport || typeof runExport.run !== 'function') {
            throw new Error('transpiled preview2 component is missing a runnable wasi:cli/run export');
        }
        let exitCode = 0;
        try {
            await runExport.run();
        }
        catch (error) {
            if (error &&
                typeof error === 'object' &&
                'exitError' in error &&
                'code' in error) {
                exitCode = Number(error.code);
            }
            else {
                throw error;
            }
        }
        return {
            exitCode,
            stdout: stdout.getText(),
            stderr: stderr.getText()
        };
    }
    finally {
        URL.revokeObjectURL(entryUrl);
    }
}
export async function executeBrowserRustArtifact(artifact, runtimeBaseUrl, options = {}) {
    if (!artifact.wasm) {
        throw new Error('wasm-rust artifact is missing wasm bytes');
    }
    if (artifact.format === 'component') {
        return runPreview2Component(artifact.wasm, runtimeBaseUrl, options);
    }
    return runPreview1WasiModule(artifact.wasm, options);
}
