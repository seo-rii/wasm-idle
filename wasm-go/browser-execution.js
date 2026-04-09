import { Directory, Fd, Inode, PreopenDirectory, WASI, wasi } from './vendor/browser_wasi_shim/index.js';
import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';
import { CaptureFd, toStandaloneBytes, writeGuestFile } from './wasi-guest.js';
const DEFAULT_RUNTIME_MANIFEST_URL = new URL('./runtime/runtime-manifest.v1.json', import.meta.url);
const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);
function createRuntimeFetch() {
    return (async (input) => {
        const url = new URL(input.toString());
        if (url.protocol !== 'file:') {
            return fetch(url);
        }
        const [{ readFile }, { fileURLToPath }] = await Promise.all([
            import('node:fs/promises'),
            import('node:url')
        ]);
        try {
            return new Response(await readFile(fileURLToPath(url)));
        }
        catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
            return new Response(null, {
                status: code === 'ENOENT' ? 404 : 500
            });
        }
    });
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
            this.currentChunk = toStandaloneBytes(nextChunk);
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
export function createBrowserWasiHost(options = {}) {
    const rootDirectory = new Directory(new Map());
    for (const file of options.files || []) {
        writeGuestFile(rootDirectory, file.path, file.contents);
    }
    const stdin = new BufferedExecutionInput(options.stdin);
    const stdout = new CaptureFd(options.stdout);
    const stderr = new CaptureFd(options.stderr);
    const env = new Map([['PWD', '/']]);
    for (const [key, value] of Object.entries(options.env || {})) {
        env.set(key, value);
    }
    return {
        args: ['main.wasm', ...(options.args || [])],
        envEntries: Array.from(env.entries()).map(([key, value]) => `${key}=${value}`),
        rootDirectory,
        stdout,
        stderr,
        fds: [
            new StdinFd(stdin),
            stdout,
            stderr,
            new PreopenDirectory('/tmp', new Map()),
            new PreopenDirectory('/', rootDirectory.contents)
        ]
    };
}
export async function executeBrowserGoArtifact(artifact, options = {}) {
    if (artifact.target === 'js/wasm' && artifact.format === 'js-wasm') {
        const fetchImpl = options.fetchImpl || createRuntimeFetch();
        const runtimeManifestUrl = options.runtimeManifestUrl || DEFAULT_RUNTIME_MANIFEST_URL;
        const runtimeBaseUrl = options.runtimeBaseUrl || new URL('./', runtimeManifestUrl.toString());
        const manifest = options.manifest
            ? normalizeRuntimeManifest(options.manifest)
            : await loadRuntimeManifest(runtimeManifestUrl, fetchImpl);
        const target = resolveTargetManifest(manifest, artifact.target);
        if (target.execution.kind !== 'js-wasm-exec' || !target.execution.wasmExecJs) {
            throw new Error(`wasm-go target ${artifact.target} is not configured for wasm_exec.js execution.`);
        }
        const wasmExecSource = new TextDecoder().decode(toStandaloneBytes(await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, target.execution.wasmExecJs), 'wasm_exec.js', fetchImpl)));
        const stdoutChunks = [];
        const stderrChunks = [];
        const decoder = new TextDecoder();
        const previousGo = globalThis.Go;
        const previousFs = globalThis.fs;
        const enosys = () => {
            const error = new Error('not implemented');
            error.code = 'ENOSYS';
            return error;
        };
        const fsShim = {
            ...(previousFs && typeof previousFs === 'object'
                ? previousFs
                : {}),
            constants: previousFs &&
                typeof previousFs === 'object' &&
                'constants' in previousFs &&
                previousFs.constants
                ? previousFs.constants
                : {
                    O_WRONLY: -1,
                    O_RDWR: -1,
                    O_CREAT: -1,
                    O_TRUNC: -1,
                    O_APPEND: -1,
                    O_EXCL: -1,
                    O_DIRECTORY: -1
                },
            writeSync(fd, buf) {
                const text = decoder.decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
                if (fd === 2) {
                    stderrChunks.push(text);
                    options.stderr?.(text);
                }
                else {
                    stdoutChunks.push(text);
                    options.stdout?.(text);
                }
                return buf.length;
            },
            write(fd, buf, offset, length, position, callback) {
                if (offset !== 0 || position !== null) {
                    callback(new Error('unsupported fs.write signature'));
                    return;
                }
                callback(null, this.writeSync(fd, buf.subarray(0, length)));
            },
            chmod(_path, _mode, callback) {
                callback(enosys());
            },
            chown(_path, _uid, _gid, callback) {
                callback(enosys());
            },
            close(_fd, callback) {
                callback(enosys());
            },
            fchmod(_fd, _mode, callback) {
                callback(enosys());
            },
            fchown(_fd, _uid, _gid, callback) {
                callback(enosys());
            },
            fstat(_fd, callback) {
                callback(enosys());
            },
            fsync(_fd, callback) {
                callback(null);
            },
            ftruncate(_fd, _length, callback) {
                callback(enosys());
            },
            lchown(_path, _uid, _gid, callback) {
                callback(enosys());
            },
            link(_path, _link, callback) {
                callback(enosys());
            },
            lstat(_path, callback) {
                callback(enosys());
            },
            mkdir(_path, _perm, callback) {
                callback(enosys());
            },
            open(_path, _flags, _mode, callback) {
                callback(enosys());
            },
            read(_fd, _buffer, _offset, _length, _position, callback) {
                callback(enosys());
            },
            readdir(_path, callback) {
                callback(enosys());
            },
            readlink(_path, callback) {
                callback(enosys());
            },
            rename(_from, _to, callback) {
                callback(enosys());
            },
            rmdir(_path, callback) {
                callback(enosys());
            },
            stat(_path, callback) {
                callback(enosys());
            },
            symlink(_path, _link, callback) {
                callback(enosys());
            },
            truncate(_path, _length, callback) {
                callback(enosys());
            },
            unlink(_path, callback) {
                callback(enosys());
            },
            utimes(_path, _atime, _mtime, callback) {
                callback(enosys());
            }
        };
        let exitCode = 0;
        try {
            globalThis.fs = fsShim;
            delete globalThis.Go;
            Function(wasmExecSource)();
            const GoRuntime = globalThis.Go;
            if (typeof GoRuntime !== 'function') {
                throw new Error('wasm_exec.js did not register a Go runtime constructor');
            }
            const go = new GoRuntime();
            go.argv = ['main.wasm', ...(options.args || [])];
            go.env = { ...(options.env || {}) };
            go.exit = (code) => {
                exitCode = code;
            };
            const instantiated = (await WebAssembly.instantiate(artifact.bytes instanceof Uint8Array
                ? artifact.bytes
                : new Uint8Array(artifact.bytes), go.importObject));
            await go.run(('instance' in instantiated ? instantiated.instance : instantiated));
        }
        finally {
            if (previousGo === undefined) {
                delete globalThis.Go;
            }
            else {
                globalThis.Go = previousGo;
            }
            if (previousFs === undefined) {
                delete globalThis.fs;
            }
            else {
                globalThis.fs = previousFs;
            }
        }
        return {
            exitCode,
            stdout: stdoutChunks.join(''),
            stderr: stderrChunks.join('')
        };
    }
    if ((artifact.target !== 'wasip1/wasm' &&
        artifact.target !== 'wasip2/wasm' &&
        artifact.target !== 'wasip3/wasm') ||
        artifact.format !== 'wasi-core-wasm') {
        throw new Error('wasm-go currently executes only wasi core-wasm or js/wasm artifacts in-process.');
    }
    const host = createBrowserWasiHost(options);
    const wasiInstance = new WASI(host.args, host.envEntries, host.fds, { debug: false });
    const bytes = artifact.bytes instanceof Uint8Array
        ? new Uint8Array(artifact.bytes)
        : new Uint8Array(artifact.bytes);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasiInstance.wasiImport
    });
    const exitCode = wasiInstance.start(instance);
    return {
        exitCode,
        stdout: host.stdout.getText(),
        stderr: host.stderr.getText()
    };
}
//# sourceMappingURL=browser-execution.js.map