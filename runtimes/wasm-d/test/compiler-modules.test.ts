import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEmscriptenLld } from '../src/emscripten-lld.js';
import { runWasiModule } from '../src/wasi-guest.js';

const memoryWasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);
const wasiWasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);

afterEach(() => vi.restoreAllMocks());

describe('D compiler module injection', () => {
	it('instantiates a supplied WASI module twice without compiling it again', async () => {
		const module = await WebAssembly.compile(wasiWasm);
		const compile = vi.spyOn(WebAssembly, 'compile');
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		expect((await runWasiModule(module)).exitCode).toBe(0);
		expect((await runWasiModule(module)).exitCode).toBe(0);
		expect(compile).not.toHaveBeenCalled();
		expect(instantiate).toHaveBeenCalledTimes(2);
		expect(instantiate.mock.calls.every(([supplied]) => supplied === module)).toBe(true);
		const first = await instantiate.mock.results[0].value;
		const second = await instantiate.mock.results[1].value;
		expect(first).not.toBe(second);
		expect(first.exports.memory).not.toBe(second.exports.memory);
	});

	it('passes the supplied LLD module to the factory and creates private memories and files each time', async () => {
		const module = await WebAssembly.compile(memoryWasm);
		const compile = vi.spyOn(WebAssembly, 'compile');
		const jsBytes = new TextEncoder().encode(`export default async function(options) {
            let instance;
            options.instantiateWasm({}, (created, compiled) => {
                if (!(compiled instanceof WebAssembly.Module)) throw new Error('missing module');
                instance = created;
            });
            const memory = new Uint8Array(instance.exports.memory.buffer);
            const files = new Map();
            return {
                FS: { mkdir() {}, writeFile(name, bytes) { files.set(name, bytes); }, readFile(name) { return files.get(name); } },
                callMain() {
                    if (files.has('/private')) throw new Error('filesystem leaked');
                    files.set('/private', new Uint8Array([1]));
                    files.set('/out.wasm', new Uint8Array([memory[0]]));
                    memory[0] = 99;
                    return 0;
                }
            };
        }`);
		const assets = {
			jsUrl: 'https://example.test/lld.js',
			jsBytes,
			wasmModule: module,
			// Deliberately invalid: the factory must instantiate the supplied module.
			wasmBytes: new Uint8Array([255]),
			dataBytes: new Uint8Array([1])
		};
		for (let run = 0; run < 2; run += 1) {
			const result = await runEmscriptenLld([], new Map(), '/out.wasm', assets);
			expect(result.exitCode).toBe(0);
			expect(result.output).toEqual(new Uint8Array([0]));
		}
		expect(compile).not.toHaveBeenCalled();
	});
});
