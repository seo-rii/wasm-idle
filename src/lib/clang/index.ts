import App from "$clang/app";
import {MemFS, untar} from "$clang/memory";
import {green, yellow, normal} from "$clang/color";
import {compile, readBuffer} from "$clang/wasm";
import {clangUrl, lldUrl, rootUrl} from "$clang/url";

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

    log?: boolean;
    showTiming?: boolean;
}

export default class Clang {
    ready: Promise<void>;
    memfs: MemFS;
    stdout: (str: string) => void;
    moduleCache: { [key: string]: WebAssembly.Module };

    showTiming: boolean;
    log: boolean;
    lastCode = '';

    constructor(options: APIOption) {
        this.moduleCache = {};
        this.stdout = options.stdout;
        this.showTiming = options.showTiming || false;
        this.log = options.log || false;

        this.memfs = new MemFS({
            stdout: this.stdout,
            stdin: options.stdin,
        });

        this.ready = this.memfs.ready.then(() => this.hostLogAsync(`Untarring ${rootUrl}`, readBuffer(rootUrl).then(buffer => untar(buffer, this.memfs))));
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

    async getModule(name: string) {
        if (this.moduleCache[name]) return this.moduleCache[name];
        const module = await this.hostLogAsync(`Fetching and compiling ${name}`, compile(name));
        this.moduleCache[name] = module;
        return module;
    }

    async compile(options: any) {
        const input = options.input;
        const code = options.code;
        const obj = options.obj;
        const opt = options.opt || '2';

        await this.ready;
        this.memfs.addFile(input, code);
        const clang = await this.getModule(clangUrl);
        return await this.run(clang, this.log, 'clang', '-cc1', '-emit-obj',
            ...clangCommonArgs, '-O' + opt, '-o', obj, '-x',
            'c++', input);
    }

    async link(obj: string, wasm: string) {
        const stackSize = 1024 * 1024;
        const libdir = 'lib/wasm32-wasi';
        const crt1 = `${libdir}/crt1.o`;
        await this.ready;
        const lld = await this.getModule(lldUrl);
        return await this.run(lld, this.log, 'wasm-ld', '--no-threads',
            '--export-dynamic',  // TODO required?
            '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc',
            '-lc++', '-lc++abi', '-lcanvas', '-o', wasm)
    }

    async run(module: WebAssembly.Module, out: boolean, ...args: string[]) {
        this.memfs.out = out;
        this.hostLog(`${args.join(' ')}\n`);
        const start = +new Date();
        const app = new App(module, this.memfs, ...args);
        const instantiate = +new Date();
        const stillRunning = await app.run();
        const end = +new Date();
        if (this.log) this.stdout('\n');
        if (this.showTiming) this.stdout(`${green}(${start - instantiate}ms/${end - instantiate}ms)${normal}\n`);
        return stillRunning ? app : null;
    }

    async compileLinkRun(code: string) {
        const input = `test.cc`, obj = `test.o`, wasm = `test.wasm`;
        if (this.lastCode !== code) {
            await this.compile({input, code, obj});
            await this.link(obj, wasm);
        }
        this.lastCode = code;

        const testMod = await this.hostLogAsync(`Compiling ${wasm}`, WebAssembly.compile(this.memfs.getFileContents(wasm)));
        return await this.run(testMod, true, wasm);
    }
}