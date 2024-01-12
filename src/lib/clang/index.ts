import App from "$lib/clang/app";
import {MemFS, untar} from "$lib/clang/memory";
import {green, yellow, normal} from "$lib/clang/color";
import {compile, readBuffer} from "$lib/clang/wasm";
import {clangUrl, lldUrl, rootUrl} from "$lib/clang/url";
import {derived, type Writable, writable} from "svelte/store";

const clangCommonArgs = [
    '-disable-free',
    '-isysroot', '/',
    '-internal-isystem', '/include/c++/v1',
    '-internal-isystem', '/include',
    '-internal-isystem', '/lib/clang/8.0.1/include',
    '-ferror-limit', '19',
    '-fmessage-length', '80',
    '-fcolor-diagnostics',
];

interface APIOption {
    stdin: () => string;
    stdout: (str: string) => void;
    progress: (value: number) => void;

    log?: boolean;
    showTiming?: boolean;
    path: string;
}

const toUtf8 = (text: string) => {
    const surrogate = encodeURIComponent(text);
    let result = '';
    for (let i = 0; i < surrogate.length;) {
        const character = surrogate[i];
        i += 1;
        if (character == '%') {
            const hex = surrogate.substring(i, i += 2);
            if (hex) result += String.fromCharCode(parseInt(hex, 16));
        } else {
            result += character;
        }
    }
    return result;
};

export default class Clang {
    ready: Promise<void>;
    memfs: MemFS;
    stdout: (str: string) => void;
    moduleCache: { [key: string]: WebAssembly.Module };

    showTiming: boolean;
    log: boolean;
    lastCode = '';
    path: string;
    wasm?: WebAssembly.Instance;
    progress = {
        clang: writable(0),
        lld: writable(0),
        memfs: writable(0),
    }


    constructor(options: APIOption) {
        this.moduleCache = {};
        this.stdout = options.stdout;
        this.showTiming = options.showTiming || false;
        this.log = options.log || false;
        this.path = options.path;

        this.memfs = new MemFS({
            stdout: this.stdout,
            stdin: options.stdin,
            path: this.path,
            progress: this.progress.memfs,
        });

        const progress = derived([this.progress.clang, this.progress.lld, this.progress.memfs], ([clang, lld, memfs]) => {
            return (clang + lld + memfs) / 3;
        });
        progress.subscribe(value => {
            options.progress(value);
        });
        this.getModule(clangUrl(this.path), this.progress.clang);
        this.getModule(lldUrl(this.path), this.progress.lld);
        this.ready = this.memfs.ready.then(() => this.hostLogAsync(`Untarring ${rootUrl(this.path)}`, readBuffer(rootUrl(this.path)).then(buffer => untar(buffer, this.memfs))));
    }

    hostLog(message: string) {
        if (!this.log) return;
        const yellowArrow = `${yellow}>${normal} `;
        this.stdout(`${yellowArrow}${message}`);
    }

    async hostLogAsync(message: string, promise: Promise<any>) {
        const start = +new Date();
        this.hostLog(`${message}...`);
        const result = await promise;
        const end = +new Date();
        if (this.log) this.stdout(' done.');
        if (this.showTiming) this.stdout(` ${green}(${end - start}ms)${normal}\n`);
        if (this.log) this.stdout('\n');
        return result;
    }

    async getModule(name: string, progress?: Writable<number>) {
        if (this.moduleCache[name]) return this.moduleCache[name];
        const module = await this.hostLogAsync(`Fetching and compiling ${name}`, compile(name, progress));
        this.moduleCache[name] = module;
        return module;
    }

    async compile(options: any) {
        const input = options.input;
        const code = toUtf8(options.code);
        const obj = options.obj;
        const opt = options.opt || '2';

        await this.ready;
        this.memfs.addFile(input, code);
        const clang = await this.getModule(clangUrl(this.path));
        return await this.run(clang, true, 'clang', '-cc1', '-emit-obj',
            ...clangCommonArgs, '-O' + opt, '-o', obj, '-std=c++17', '-x',
            'c++', input);
    }

    async link(obj: string, wasm: string) {
        const stackSize = 1024 * 1024;
        const libdir = 'lib/wasm32-wasi';
        const crt1 = `${libdir}/crt1.o`;
        await this.ready;
        const lld = await this.getModule(lldUrl(this.path));
        return await this.run(lld, this.log, 'wasm-ld', '--no-threads',
            '--export-dynamic',  // TODO required?
            '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc',
            '-lc++', '-lc++abi', '-lm', `-Llib/clang/8.0.1/lib/wasi`, '-lclang_rt.builtins-wasm32', '-o', wasm)
    }

    async run(module: WebAssembly.Module, out: boolean, ...args: string[]) {
        this.memfs.out = out;
        this.hostLog(`${args.join(' ')}\n`);
        const start = +new Date();
        const app = new App(module, this.memfs, args[0], ...args.slice(1));
        const instantiate = +new Date();
        const stillRunning = await app.run();
        const end = +new Date();
        if (this.log) this.stdout('\n');
        if (this.showTiming) this.stdout(`${green}(${start - instantiate}ms/${end - instantiate}ms)${normal}\n`);
        return stillRunning ? app : null;
    }

    async compileLink(code: string) {
        const input = `test.cc`, obj = `test.o`, wasm = `test.wasm`;
        if (this.lastCode === code) return this.wasm;
        await this.compile({input, code, obj});
        await this.link(obj, wasm);

        this.lastCode = code;
        return this.wasm = await this.hostLogAsync(`Compiling ${wasm}`, WebAssembly.compile(this.memfs.getFileContents(wasm)));
    }

    async compileLinkRun(code: string) {
        return await this.run(await this.compileLink(code), true, `test.wasm`);
    }
}