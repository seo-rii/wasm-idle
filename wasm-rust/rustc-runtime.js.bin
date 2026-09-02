import { Directory, Fd, File, Inode, OpenFile, OpenDirectory, PreopenDirectory, WASI, wasi } from './vendor/browser_wasi_shim/index.js';
import { SharedWorkspaceFile, SharedWorkspaceStore } from './shared-workspace.js';
const BITCODE_LENGTH_INDEX = 0;
const BITCODE_OVERFLOW_INDEX = 1;
const BITCODE_WRITE_SEQUENCE_INDEX = 2;
const BITCODE_HEADER_LENGTH = 16;
const RUSTC_STRING_GROW_BY_IMPORT = '_ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE9__grow_byEmmmmmm';
export const DEFAULT_RUSTC_ENV = ['RUST_MIN_STACK=8388608'];
export class CaptureFd extends Fd {
    ino;
    decoder = new TextDecoder();
    chunks = [];
    output;
    constructor(output = null) {
        super();
        this.ino = Inode.issue_ino();
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
    getText() {
        const trailing = this.decoder.decode();
        if (trailing) {
            this.chunks.push(trailing);
            this.output?.(trailing);
        }
        return this.chunks.join('');
    }
}
class OpenMirroredBitcodeFile extends Fd {
    position = 0n;
    file;
    constructor(file) {
        super();
        this.file = file;
    }
    fd_allocate(offset, len) {
        if (Number(offset + len) > this.file.capacity) {
            Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
            return wasi.ERRNO_NOSPC;
        }
        return wasi.ERRNO_SUCCESS;
    }
    fd_fdstat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, 0)
        };
    }
    fd_filestat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            filestat: this.file.stat()
        };
    }
    fd_filestat_set_size(size) {
        if (Number(size) > this.file.capacity) {
            Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
            return wasi.ERRNO_NOSPC;
        }
        if (Number(size) < Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
            this.file.bytes.fill(0, Number(size), Atomics.load(this.file.state, BITCODE_LENGTH_INDEX));
        }
        Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, Number(size));
        Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
        Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
        return wasi.ERRNO_SUCCESS;
    }
    fd_read(size) {
        const end = Math.min(Atomics.load(this.file.state, BITCODE_LENGTH_INDEX), Number(this.position) + size);
        const data = this.file.bytes.slice(Number(this.position), end);
        this.position = BigInt(end);
        return {
            ret: wasi.ERRNO_SUCCESS,
            data
        };
    }
    fd_pread(size, offset) {
        const end = Math.min(Atomics.load(this.file.state, BITCODE_LENGTH_INDEX), Number(offset) + size);
        return {
            ret: wasi.ERRNO_SUCCESS,
            data: this.file.bytes.slice(Number(offset), end)
        };
    }
    fd_seek(offset, whence) {
        let nextPosition = this.position;
        if (whence === wasi.WHENCE_SET) {
            nextPosition = offset;
        }
        else if (whence === wasi.WHENCE_CUR) {
            nextPosition = this.position + offset;
        }
        else if (whence === wasi.WHENCE_END) {
            nextPosition = BigInt(Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) + offset;
        }
        if (nextPosition < 0n) {
            return {
                ret: wasi.ERRNO_INVAL,
                offset: 0n
            };
        }
        this.position = nextPosition;
        return {
            ret: wasi.ERRNO_SUCCESS,
            offset: this.position
        };
    }
    fd_tell() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            offset: this.position
        };
    }
    fd_write(data) {
        const nextLength = Number(this.position) + data.byteLength;
        if (nextLength > this.file.capacity) {
            Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
            return {
                ret: wasi.ERRNO_NOSPC,
                nwritten: 0
            };
        }
        this.file.bytes.set(data, Number(this.position));
        this.position = BigInt(nextLength);
        if (nextLength > Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
            Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, nextLength);
        }
        Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
        Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
        return {
            ret: wasi.ERRNO_SUCCESS,
            nwritten: data.byteLength
        };
    }
    fd_pwrite(data, offset) {
        const nextLength = Number(offset) + data.byteLength;
        if (nextLength > this.file.capacity) {
            Atomics.store(this.file.state, BITCODE_OVERFLOW_INDEX, 1);
            return {
                ret: wasi.ERRNO_NOSPC,
                nwritten: 0
            };
        }
        this.file.bytes.set(data, Number(offset));
        if (nextLength > Atomics.load(this.file.state, BITCODE_LENGTH_INDEX)) {
            Atomics.store(this.file.state, BITCODE_LENGTH_INDEX, nextLength);
        }
        Atomics.add(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
        Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
        return {
            ret: wasi.ERRNO_SUCCESS,
            nwritten: data.byteLength
        };
    }
    fd_sync() {
        Atomics.notify(this.file.state, BITCODE_WRITE_SEQUENCE_INDEX);
        return wasi.ERRNO_SUCCESS;
    }
}
export class MirroredBitcodeFile extends Inode {
    state;
    bytes;
    capacity;
    constructor(sharedBuffer) {
        super();
        this.state = new Int32Array(sharedBuffer, 0, BITCODE_HEADER_LENGTH / 4);
        this.bytes = new Uint8Array(sharedBuffer, BITCODE_HEADER_LENGTH);
        this.capacity = this.bytes.byteLength;
    }
    replaceWith(data) {
        if (data.byteLength > this.capacity) {
            Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 1);
            return wasi.ERRNO_NOSPC;
        }
        this.bytes.fill(0, 0, Atomics.load(this.state, BITCODE_LENGTH_INDEX));
        this.bytes.set(data, 0);
        Atomics.store(this.state, BITCODE_LENGTH_INDEX, data.byteLength);
        Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 0);
        Atomics.add(this.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
        Atomics.notify(this.state, BITCODE_WRITE_SEQUENCE_INDEX);
        return wasi.ERRNO_SUCCESS;
    }
    path_open(oflags) {
        if ((oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC) {
            this.bytes.fill(0, 0, Atomics.load(this.state, BITCODE_LENGTH_INDEX));
            Atomics.store(this.state, BITCODE_LENGTH_INDEX, 0);
            Atomics.store(this.state, BITCODE_OVERFLOW_INDEX, 0);
            Atomics.add(this.state, BITCODE_WRITE_SEQUENCE_INDEX, 1);
            Atomics.notify(this.state, BITCODE_WRITE_SEQUENCE_INDEX);
        }
        return {
            ret: wasi.ERRNO_SUCCESS,
            fd_obj: new OpenMirroredBitcodeFile(this)
        };
    }
    stat() {
        return new wasi.Filestat(this.ino, wasi.FILETYPE_REGULAR_FILE, BigInt(Atomics.load(this.state, BITCODE_LENGTH_INDEX)));
    }
}
export function readMirroredBitcode(sharedBuffer) {
    const state = new Int32Array(sharedBuffer, 0, BITCODE_HEADER_LENGTH / 4);
    const bytes = new Uint8Array(sharedBuffer, BITCODE_HEADER_LENGTH);
    const length = Atomics.load(state, BITCODE_LENGTH_INDEX);
    return {
        length,
        overflowed: Atomics.load(state, BITCODE_OVERFLOW_INDEX) === 1,
        writeSequence: Atomics.load(state, BITCODE_WRITE_SEQUENCE_INDEX),
        bytes: bytes.slice(0, length)
    };
}
export function createSharedSafeRandomGet(memory) {
    return (pointer, length) => {
        const target = new Uint8Array(memory.buffer, pointer, length);
        const randomBytes = new Uint8Array(length);
        crypto.getRandomValues(randomBytes);
        target.set(randomBytes);
        return wasi.ERRNO_SUCCESS;
    };
}
class MirroredBitcodeOpenDirectory extends OpenDirectory {
    mirroredBitcodePath;
    sharedWorkspace;
    sharedPathPrefix;
    constructor(dir, mirroredBitcodePath, sharedWorkspace, sharedPathPrefix) {
        super(dir);
        this.mirroredBitcodePath = mirroredBitcodePath;
        this.sharedWorkspace = sharedWorkspace;
        this.sharedPathPrefix = sharedPathPrefix;
    }
    resolveMirroredBitcodeFile(pathStr) {
        if (pathStr !== this.mirroredBitcodePath) {
            return null;
        }
        const segments = pathStr.split('/').filter(Boolean);
        let entry = this.dir;
        for (const segment of segments) {
            if (!(entry instanceof Directory)) {
                return null;
            }
            entry = entry.contents.get(segment);
        }
        return entry instanceof MirroredBitcodeFile ? entry : null;
    }
    resolveSharedWorkspacePath(pathStr) {
        if (pathStr.startsWith('/') || pathStr.includes('\0')) {
            return null;
        }
        const parts = [];
        for (const part of pathStr.split('/')) {
            if (!part || part === '.') {
                continue;
            }
            if (part === '..') {
                if (parts.pop() === undefined) {
                    return null;
                }
                continue;
            }
            parts.push(part);
        }
        const relativePath = parts.join('/');
        const workspacePath = [this.sharedPathPrefix, relativePath].filter(Boolean).join('/');
        return workspacePath.startsWith('work/') || workspacePath.startsWith('tmp/')
            ? workspacePath
            : null;
    }
    installSharedWorkspaceFile(pathStr, file) {
        this.installSharedParentDirectories(pathStr);
        const linked = super.path_link(pathStr, file, true);
        return linked === wasi.ERRNO_SUCCESS ? file : null;
    }
    installSharedParentDirectories(pathStr) {
        const parts = pathStr.split('/').filter((part) => part && part !== '.');
        for (let index = 1; index < parts.length; index += 1) {
            const localPath = parts.slice(0, index).join('/');
            if (super.path_lookup(localPath, 0).inode_obj instanceof Directory) {
                continue;
            }
            const workspacePath = this.resolveSharedWorkspacePath(localPath);
            if (!workspacePath || !this.sharedWorkspace.hasDirectory(workspacePath)) {
                return false;
            }
            if (this.dir.create_entry_for_path(localPath, true).ret !== wasi.ERRNO_SUCCESS) {
                return false;
            }
        }
        return true;
    }
    installSharedDirectory(pathStr) {
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (!workspacePath || !this.sharedWorkspace.hasDirectory(workspacePath)) {
            return null;
        }
        this.installSharedParentDirectories(pathStr);
        const created = this.dir.create_entry_for_path(pathStr, true).ret;
        if (created !== wasi.ERRNO_SUCCESS && created !== wasi.ERRNO_EXIST) {
            return null;
        }
        return super.path_lookup(pathStr, 0).inode_obj;
    }
    path_lookup(pathStr, dirflags) {
        const local = super.path_lookup(pathStr, dirflags);
        if (local.inode_obj !== null) {
            return local;
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath === null) {
            return local;
        }
        const shared = this.sharedWorkspace.open(workspacePath, false);
        if (shared !== null && this.installSharedWorkspaceFile(pathStr, shared) !== null) {
            return {
                ret: wasi.ERRNO_SUCCESS,
                inode_obj: shared
            };
        }
        const directory = this.installSharedDirectory(pathStr);
        return directory ? { ret: wasi.ERRNO_SUCCESS, inode_obj: directory } : local;
    }
    path_open(dirflags, pathStr, oflags, fsRightsBase, fsRightsInheriting, fdFlags) {
        const local = super.path_lookup(pathStr, dirflags);
        if (local.inode_obj !== null) {
            return super.path_open(dirflags, pathStr, oflags, fsRightsBase, fsRightsInheriting, fdFlags);
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath === null) {
            return super.path_open(dirflags, pathStr, oflags, fsRightsBase, fsRightsInheriting, fdFlags);
        }
        if ((oflags & wasi.OFLAGS_DIRECTORY) === wasi.OFLAGS_DIRECTORY) {
            const directory = this.installSharedDirectory(pathStr);
            return directory
                ? directory.path_open(oflags, fsRightsBase, fdFlags)
                : { ret: wasi.ERRNO_NOENT, fd_obj: null };
        }
        const shared = this.sharedWorkspace.open(workspacePath, (oflags & wasi.OFLAGS_CREAT) === wasi.OFLAGS_CREAT);
        if (shared === null || this.installSharedWorkspaceFile(pathStr, shared) === null) {
            return {
                ret: this.sharedWorkspace.hasOverflowed() ? wasi.ERRNO_NOSPC : wasi.ERRNO_NOENT,
                fd_obj: null
            };
        }
        return shared.path_open(oflags);
    }
    path_create_directory(pathStr) {
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath === null) {
            return super.path_create_directory(pathStr);
        }
        if (!this.installSharedParentDirectories(pathStr)) {
            return wasi.ERRNO_NOENT;
        }
        if (!this.sharedWorkspace.createDirectory(workspacePath)) {
            return this.sharedWorkspace.hasOverflowed() ? wasi.ERRNO_NOSPC : wasi.ERRNO_EXIST;
        }
        const created = this.dir.create_entry_for_path(pathStr, true).ret;
        return created === wasi.ERRNO_EXIST ? wasi.ERRNO_SUCCESS : created;
    }
    path_filestat_get(flags, pathStr) {
        const mirrored = this.resolveMirroredBitcodeFile(pathStr);
        if (mirrored instanceof MirroredBitcodeFile &&
            Atomics.load(mirrored.state, BITCODE_LENGTH_INDEX) === 0) {
            return {
                ret: wasi.ERRNO_NOENT,
                filestat: null
            };
        }
        const localLookup = super.path_lookup(pathStr, flags);
        if (localLookup.inode_obj instanceof SharedWorkspaceFile &&
            localLookup.inode_obj.length === 0) {
            return {
                ret: wasi.ERRNO_NOENT,
                filestat: null
            };
        }
        const local = super.path_filestat_get(flags, pathStr);
        if (local.filestat !== null) {
            return local;
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        const shared = workspacePath && this.sharedWorkspace.open(workspacePath, false);
        if (shared instanceof SharedWorkspaceFile && shared.length === 0) {
            return {
                ret: wasi.ERRNO_NOENT,
                filestat: null
            };
        }
        if (!shared || this.installSharedWorkspaceFile(pathStr, shared) === null) {
            return local;
        }
        return {
            ret: wasi.ERRNO_SUCCESS,
            filestat: shared.stat()
        };
    }
    path_link(pathStr, inode, allowDir) {
        const mirrored = this.resolveMirroredBitcodeFile(pathStr);
        if (mirrored instanceof MirroredBitcodeFile && inode instanceof File) {
            return mirrored.replaceWith(inode.data);
        }
        if (mirrored instanceof MirroredBitcodeFile && inode instanceof SharedWorkspaceFile) {
            return mirrored.replaceWith(inode.snapshot());
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath !== null && inode instanceof SharedWorkspaceFile) {
            if (!inode.rename(workspacePath)) {
                return wasi.ERRNO_IO;
            }
            return this.installSharedWorkspaceFile(pathStr, inode)
                ? wasi.ERRNO_SUCCESS
                : wasi.ERRNO_IO;
        }
        if (workspacePath !== null && inode instanceof File) {
            const shared = this.sharedWorkspace.open(workspacePath, true);
            if (shared === null || !shared.write(0, inode.data)) {
                return wasi.ERRNO_NOSPC;
            }
            return this.installSharedWorkspaceFile(pathStr, shared)
                ? wasi.ERRNO_SUCCESS
                : wasi.ERRNO_IO;
        }
        return super.path_link(pathStr, inode, allowDir);
    }
    path_unlink(pathStr) {
        const mirrored = this.resolveMirroredBitcodeFile(pathStr);
        if (mirrored instanceof MirroredBitcodeFile) {
            return {
                ret: wasi.ERRNO_SUCCESS,
                inode_obj: mirrored
            };
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        const shared = workspacePath && this.sharedWorkspace.remove(workspacePath);
        if (shared) {
            super.path_unlink(pathStr);
            return {
                ret: wasi.ERRNO_SUCCESS,
                inode_obj: shared
            };
        }
        return super.path_unlink(pathStr);
    }
    path_unlink_file(pathStr) {
        if (this.resolveMirroredBitcodeFile(pathStr) instanceof MirroredBitcodeFile) {
            return wasi.ERRNO_SUCCESS;
        }
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath && this.sharedWorkspace.remove(workspacePath)) {
            super.path_unlink_file(pathStr);
            return wasi.ERRNO_SUCCESS;
        }
        return super.path_unlink_file(pathStr);
    }
    path_remove_directory(pathStr) {
        const workspacePath = this.resolveSharedWorkspacePath(pathStr);
        if (workspacePath && this.sharedWorkspace.removeDirectory(workspacePath)) {
            const removed = super.path_remove_directory(pathStr);
            return removed === wasi.ERRNO_NOENT ? wasi.ERRNO_SUCCESS : removed;
        }
        return super.path_remove_directory(pathStr);
    }
}
class MirroredBitcodePreopenDirectory extends MirroredBitcodeOpenDirectory {
    prestatName;
    constructor(name, dir, mirroredBitcodePath, sharedWorkspace, sharedPathPrefix) {
        super(dir, mirroredBitcodePath, sharedWorkspace, sharedPathPrefix);
        this.prestatName = name;
    }
    fd_prestat_get() {
        return {
            ret: wasi.ERRNO_SUCCESS,
            prestat: wasi.Prestat.dir(this.prestatName)
        };
    }
}
class MirroredBitcodeDirectory extends Directory {
    mirroredBitcodePath;
    sharedWorkspace;
    sharedPathPrefix;
    constructor(contents, mirroredBitcodePath, sharedWorkspace, sharedPathPrefix) {
        super(contents);
        this.mirroredBitcodePath = mirroredBitcodePath;
        this.sharedWorkspace = sharedWorkspace;
        this.sharedPathPrefix = sharedPathPrefix;
    }
    path_open(oflags) {
        return {
            ret: wasi.ERRNO_SUCCESS,
            fd_obj: new MirroredBitcodeOpenDirectory(this, this.mirroredBitcodePath, this.sharedWorkspace, this.sharedPathPrefix)
        };
    }
}
export async function buildPreopenedDirectories(manifest, sysrootAssets, sourceCode, sharedBitcodeBuffer, sharedWorkspaceBuffer) {
    const sharedWorkspace = new SharedWorkspaceStore(sharedWorkspaceBuffer);
    const sysrootRoot = new Directory(new Map());
    for (const entry of sysrootAssets) {
        const runtimeSegments = entry.runtimePath.replace(/^\/+/, '').split('/');
        let directory = sysrootRoot;
        for (const segment of runtimeSegments.slice(0, -1)) {
            const existing = directory.contents.get(segment);
            if (existing instanceof Directory) {
                directory = existing;
                continue;
            }
            const nextDirectory = new Directory(new Map());
            directory.contents.set(segment, nextDirectory);
            directory = nextDirectory;
        }
        directory.contents.set(runtimeSegments.at(-1), new File(new Uint8Array(entry.buffer), { readonly: true }));
    }
    const workRoot = new MirroredBitcodeDirectory(new Map([
        ['main.rs', new File(new TextEncoder().encode(sourceCode))],
        [manifest.compiler.workerBitcodeFile, new MirroredBitcodeFile(sharedBitcodeBuffer)]
    ]), manifest.compiler.workerBitcodeFile, sharedWorkspace, 'work');
    const tmpRoot = new MirroredBitcodeDirectory(new Map(), '', sharedWorkspace, 'tmp');
    const rootDirectory = new Directory(new Map([
        ['sysroot', sysrootRoot],
        ['work', workRoot],
        ['tmp', tmpRoot]
    ]));
    const stdout = new CaptureFd();
    const stderr = new CaptureFd();
    const workDirectory = new MirroredBitcodePreopenDirectory('/work', workRoot, manifest.compiler.workerBitcodeFile, sharedWorkspace, 'work');
    const rootPreopenDirectory = new MirroredBitcodePreopenDirectory('/', rootDirectory, `work/${manifest.compiler.workerBitcodeFile}`, sharedWorkspace, '');
    const tmpDirectory = new MirroredBitcodePreopenDirectory('/tmp', tmpRoot, '', sharedWorkspace, 'tmp');
    return {
        stdout,
        stderr,
        fds: [
            new OpenFile(new File(new Uint8Array(), { readonly: true })),
            stdout,
            stderr,
            tmpDirectory,
            new PreopenDirectory('/sysroot', sysrootRoot.contents),
            workDirectory,
            rootPreopenDirectory
        ]
    };
}
export async function instantiateRustcInstance({ rustcModule, memory, args, env = DEFAULT_RUSTC_ENV, fds, threadSpawner }) {
    const wasiInstance = new WASI(args, env, fds, { debug: false });
    wasiInstance.wasiImport.random_get = createSharedSafeRandomGet(memory);
    const instance = await WebAssembly.instantiate(rustcModule, {
        env: {
            memory,
            [RUSTC_STRING_GROW_BY_IMPORT]: () => { }
        },
        wasi: {
            'thread-spawn': threadSpawner
        },
        wasi_snapshot_preview1: wasiInstance.wasiImport
    });
    wasiInstance.inst = instance;
    return { instance, wasiInstance };
}
