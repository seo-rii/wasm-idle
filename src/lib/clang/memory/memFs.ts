import {Memory} from '$lib/clang/memory';
import {bindNew} from "$lib/clang/apply";
import {AbortError, assert} from "$lib/clang/error";
import {compile} from "$lib/clang/wasm";
import {memfsUrl} from "$lib/clang/url";

const ESUCCESS = 0;

interface MemFsOptions {
    stdin: () => string;
    stdout: (str: string) => void;
    stdinStr?: string;
    path: string
}

export default class MemFS {
    ready: Promise<void>;
    mem: Memory = <any>null;
    hostMem_: Memory = <any>null;
    stdinStr: string;
    stdin: () => string;
    stdout: (str: string) => void;
    instance: WebAssembly.Instance = <any>null;
    exports: any;
    out = true;

    constructor(options: MemFsOptions) {
        this.stdin = options.stdin;
        this.stdout = options.stdout;
        this.stdinStr = options.stdinStr || "";

        const env = bindNew(this, 'abort', 'host_write', 'host_read', 'memfs_log', 'copy_in', 'copy_out');

        this.ready = compile(memfsUrl(options.path))
            .then(module => WebAssembly.instantiate(module, {env}))
            .then(instance => {
                this.instance = instance;
                this.exports = instance.exports;
                this.mem = new Memory(this.exports.memory);
                this.exports.init();
            });
    }

    set hostMem(mem: Memory) {
        this.hostMem_ = mem;
    }

    setStdinStr(str: string) {
        this.stdinStr = str;
    }

    addDirectory(path: string) {
        this.mem.check();
        this.mem.write(this.exports.GetPathBuf(), path);
        this.exports.AddDirectoryNode(path.length);
    }

    addFile(path: string, contents: string | ArrayBuffer | Uint8Array) {
        const length = contents instanceof ArrayBuffer ? contents.byteLength : contents.length;
        this.mem.check();
        this.mem.write(this.exports.GetPathBuf(), path);
        const inode = this.exports.AddFileNode(path.length, length);
        const addr = this.exports.GetFileNodeAddress(inode);
        this.mem.check();
        this.mem.write(addr, contents);
    }

    getFileContents(path: string) {
        this.mem.check();
        this.mem.write(this.exports.GetPathBuf(), path);
        const inode = this.exports.FindNode(path.length);
        const addr = this.exports.GetFileNodeAddress(inode);
        const size = this.exports.GetFileNodeSize(inode);
        return new Uint8Array(this.mem.buffer, addr, size);
    }

    abort() {
        throw new AbortError();
    }

    host_write(fd: number, iovs: number, iovs_len: number, nwritten_out: number) {
        this.hostMem_.check();
        assert(fd <= 2);
        let size = 0;
        let str = '';
        for (let i = 0; i < iovs_len; ++i) {
            const buf = this.hostMem_.read32(iovs);
            iovs += 4;
            const len = this.hostMem_.read32(iovs);
            iovs += 4;
            str += this.hostMem_.readStrR(buf, len);
            size += len;
        }
        this.hostMem_.write32(nwritten_out, size);
        if (this.out) this.stdout(str);
        return ESUCCESS;
    }

    host_read(fd: number, iovs: number, iovs_len: number, nread: number) {
        this.hostMem_.check();
        assert(fd === 0);
        let size = 0;
        for (let i = 0; i < iovs_len; ++i) {
            const buf = this.hostMem_.read32(iovs);
            iovs += 4;
            const len = this.hostMem_.read32(iovs);
            iovs += 4;
            if (!this.stdinStr.length) this.stdinStr = this.stdin();
            const lenToWrite = Math.min(len, this.stdinStr.length);
            if (lenToWrite === 0) break;
            this.hostMem_.write(buf, this.stdinStr.substring(0, lenToWrite));
            this.stdinStr = this.stdinStr.substring(lenToWrite);
            size += lenToWrite;
            if (lenToWrite !== len) break;
        }
        this.hostMem_.write32(nread, size);
        return ESUCCESS;
    }

    memfs_log(buf: number, len: number) {
        this.mem.check();
        console.log(this.mem.readStr(buf, len));
    }

    copy_out(clang_dst: number, memfs_src: number, size: number) {
        this.hostMem_.check();
        const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
        this.mem.check();
        const src = new Uint8Array(this.mem.buffer, memfs_src, size);
        dst.set(src);
    }

    copy_in(memfs_dst: number, clang_src: number, size: number) {
        this.mem.check();
        const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
        this.hostMem_.check();
        const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
        dst.set(src);
    }
}