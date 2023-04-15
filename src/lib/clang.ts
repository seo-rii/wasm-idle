import App from "$lib/app";
import {MemFS, untar} from "$lib/memory";
import {green, yellow, normal} from "$lib/color";
import {compile, readBuffer} from "$lib/wasm";
import {clangUrl, lldUrl, rootUrl} from "$lib/url";

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
    stdout: (str: string) => void;

    showTiming?: boolean;
}

export default class Clang {
    ready: Promise<void>;
    memfs: MemFS;
    stdout: (str: string) => void;
    moduleCache: { [key: string]: WebAssembly.Module };

    showTiming: boolean;

    constructor(options: APIOption) {

        this.moduleCache = {};
        this.stdout = options.stdout;
        this.showTiming = options.showTiming || false;

        this.memfs = new MemFS({
            stdout: this.stdout,
        });

        this.ready = this.memfs.ready.then(() => this.hostLogAsync(`Untarring ${rootUrl}`, readBuffer(rootUrl).then(buffer => untar(buffer, this.memfs))));
    }

    hostLog(message: string) {
        const yellowArrow = `${yellow}>${normal} `;
        this.stdout(`${yellowArrow}${message}`);
    }

    async hostLogAsync(message: string, promise: Promise<any>) {
        const start = +new Date();
        this.hostLog(`${message}...`);
        const result = await promise;
        const end = +new Date();
        this.stdout(' done.');
        if (this.showTiming) {
            this.stdout(` ${green}(${end - start}ms)${normal}\n`);
        }
        this.stdout('\n');
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
        const contents = options.contents;
        const obj = options.obj;
        const opt = options.opt || '2';

        await this.ready;
        this.memfs.addFile(input, contents);
        const clang = await this.getModule(clangUrl);
        return await this.run(clang, 'clang', '-cc1', '-emit-obj',
            ...clangCommonArgs, '-O' + opt, '-o', obj, '-x',
            'c++', input);
    }

    async link(obj: string, wasm: string) {
        const stackSize = 1024 * 1024;
        const libdir = 'lib/wasm32-wasi';
        const crt1 = `${libdir}/crt1.o`;
        await this.ready;
        const lld = await this.getModule(lldUrl);
        return await this.run(lld, 'wasm-ld', '--no-threads',
            '--export-dynamic',  // TODO required?
            '-z', `stack-size=${stackSize}`, `-L${libdir}`, crt1, obj, '-lc',
            '-lc++', '-lc++abi', '-lcanvas', '-o', wasm)
    }

    async run(module: WebAssembly.Module, ...args: string[]) {
        this.hostLog(`${args.join(' ')}\n`);
        const start = +new Date();
        const app = new App(module, this.memfs, ...args);
        const instantiate = +new Date();
        const stillRunning = await app.run();
        const end = +new Date();
        this.stdout('\n');
        if (this.showTiming) this.stdout(`${green}(${start - instantiate}ms/${end - instantiate}ms)${normal}\n`);
        return stillRunning ? app : null;
    }

    async compileLinkRun(contents: string) {
        const input = `test.cc`, obj = `test.o`, wasm = `test.wasm`;
        await this.compile({input, contents, obj});
        await this.link(obj, wasm);

        const testMod = await this.hostLogAsync(`Compiling ${wasm}`, WebAssembly.compile(this.memfs.getFileContents(wasm)));
        return await this.run(testMod, wasm);
    }
}