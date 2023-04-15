import {bindNew} from "$lib/apply";
import {Memory, type MemFS} from "$lib/memory";
import {getInstance} from "$lib/wasm";
import {NotImplemented, ProcExit} from "$lib/error";

const ESUCCESS = 0;
const RAF_PROC_EXIT_CODE = 0xC0C0A;

export default class App {
    ready: Promise<void>

    mem: Memory = <any>null
    memfs: MemFS
    instance: WebAssembly.Instance = <any>null
    exports: any

    argv: string[]
    environ: { [key: string]: string }
    handles = new Map<number, any>()
    nextHandle = 0

    constructor(module: WebAssembly.Module, memfs: MemFS, name: string, ...args: string[]) {
        this.argv = [name, ...args];
        this.environ = {USER: 'jungol'};
        this.memfs = memfs;

        const env = bindNew(this);

        const wasi_unstable = {
            ...bindNew(this, 'proc_exit', 'environ_sizes_get', 'environ_get', 'args_sizes_get',
                'args_get', 'random_get', 'clock_time_get', 'poll_oneoff'), ...this.memfs.exports
        };

        this.ready = getInstance(module, {wasi_unstable, env}).then(instance => {
            this.instance = instance;
            this.exports = this.instance.exports;
            this.mem = new Memory(this.exports.memory);
            this.memfs.hostMem = this.mem;
        });
    }

    async run() {
        await this.ready;
        try {
            this.exports._start();
        } catch (exn: any) {
            let writeStack = true;
            if (exn instanceof ProcExit) {
                if (exn.code === RAF_PROC_EXIT_CODE) {
                    console.log('Allowing rAF after exit.');
                    return true;
                }
                // Don't allow rAF unless you return the right code.
                console.log(`Disallowing rAF since exit code is ${exn.code}.`);
                if (exn.code == 0) return false;
                writeStack = false;
            }

            // Write error message.
            let msg = `\x1b[91mError: ${exn.message}`;
            if (writeStack) msg = msg + `\n${exn.stack}`;
            msg += '\x1b[0m\n';
            this.memfs.stdout(msg);

            // Propagate error.
            throw exn;
        }
    }

    proc_exit(code: number) {
        throw new ProcExit(code);
    }

    environ_sizes_get(environ_count_out: number, environ_buf_size_out: number) {
        this.mem.check();
        let size = 0;
        const names = Object.getOwnPropertyNames(this.environ);
        for (const name of names) {
            const value = this.environ[name];
            // +2 to account for = and \0 in "name=value\0".
            size += name.length + value.length + 2;
        }
        this.mem.write64(environ_count_out, names.length);
        this.mem.write64(environ_buf_size_out, size);
        return ESUCCESS;
    }

    environ_get(environ_ptrs: number, environ_buf: number) {
        this.mem.check();
        const names = Object.getOwnPropertyNames(this.environ);
        for (const name of names) {
            this.mem.write32(environ_ptrs, environ_buf);
            environ_ptrs += 4;
            environ_buf +=
                this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
        }
        this.mem.write32(environ_ptrs, 0);
        return ESUCCESS;
    }

    args_sizes_get(argc_out: number, argv_buf_size_out: number) {
        this.mem.check();
        let size = 0;
        for (let arg of this.argv) {
            size += arg.length + 1;  // "arg\0".
        }
        this.mem.write64(argc_out, this.argv.length);
        this.mem.write64(argv_buf_size_out, size);
        return ESUCCESS;
    }

    args_get(argv_ptrs: number, argv_buf: number) {
        this.mem.check();
        for (let arg of this.argv) {
            this.mem.write32(argv_ptrs, argv_buf);
            argv_ptrs += 4;
            argv_buf += this.mem.writeStr(argv_buf, arg);
        }
        this.mem.write32(argv_ptrs, 0);
        return ESUCCESS;
    }

    random_get(buf: number, buf_len: number) {
        const data = new Uint8Array(this.mem.buffer, buf, buf_len);
        for (let i = 0; i < buf_len; ++i) data[i] = (Math.random() * 256) | 0;
    }

    clock_time_get() {
        throw new NotImplemented('wasi_unstable', 'clock_time_get');
    }

    poll_oneoff() {
        throw new NotImplemented('wasi_unstable', 'poll_oneoff');
    }
}