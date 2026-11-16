// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SQUIRREL_PROFILE } from '../squirrelProfile';

const PAGE = 65536;
const messages: any[] = [];

beforeEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.stubGlobal('self', globalThis);
	vi.stubGlobal('postMessage', (message: unknown) => messages.push(message));
	messages.length = 0;
});

afterEach(() => vi.unstubAllGlobals());

async function load(maxWasmMemoryBytes?: number) {
	const bytes = await readFile('static/wasm-squirrel/squirrel.wasm');
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(bytes))
	);
	await import('./wasm');
	await (globalThis as any).onmessage({
		data: {
			load: true,
			interpreter: SQUIRREL_PROFILE,
			interpreterUrl: 'https://wasm-idle.test/wasm-squirrel/squirrel.wasm',
			persistentCache: false,
			maxWasmMemoryBytes
		}
	});
}

async function run(maxWasmMemoryBytes: number, prepare = false) {
	messages.length = 0;
	await (globalThis as any).onmessage({
		data: {
			code: 'print(6 * 7 + "\\n");',
			activePath: 'main.nut',
			stdin: '',
			maxWasmMemoryBytes,
			prepare
		}
	});
}

describe('WASI interpreter memory budgets', () => {
	it('rejects a startup budget below real interpreter initial memory before instantiation', async () => {
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		await load(PAGE);
		expect(messages.some((message) => message.load)).toBe(false);
		expect(messages).toContainEqual(
			expect.objectContaining({
				error: expect.stringMatching(/initial memory exceeds/u)
			})
		);
		expect(instantiate).not.toHaveBeenCalled();
	});

	it.each([false, true])('rejects a tighter execution budget (prepare=%s)', async (prepare) => {
		await load();
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		await run(PAGE, prepare);
		expect(messages.some((message) => message.results)).toBe(false);
		expect(messages).toContainEqual(
			expect.objectContaining({
				error: expect.stringMatching(/initial memory exceeds/u)
			})
		);
		expect(instantiate).not.toHaveBeenCalled();
	});

	it('caps actual memory.grow separately for each real interpreter instance', async () => {
		await load();
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		for (const budget of [8 * 1024 * 1024 + 17, 4 * 1024 * 1024, 12 * 1024 * 1024]) {
			await run(budget);
			expect(messages.filter((message) => message.error)).toEqual([]);
			expect(messages.map((message) => message.output ?? '').join('')).toBe('42\n');
			expect(messages).toContainEqual({ results: true });
			const instance = (await instantiate.mock.results.at(-1)!.value) as WebAssembly.Instance;
			const memory = instance.exports.memory as WebAssembly.Memory;
			const maximumPages = Math.floor(budget / PAGE);
			memory.grow(maximumPages - memory.buffer.byteLength / PAGE);
			expect(memory.buffer.byteLength).toBe(maximumPages * PAGE);
			expect(() => memory.grow(1)).toThrow(RangeError);
		}
	});

	it('leaves generic memoryless, imported-memory and multiple-memory preparation unchanged', async () => {
		await import('./wasm');
		const header = [0, 97, 115, 109, 1, 0, 0, 0];
		for (const bytes of [
			Uint8Array.from(header),
			Uint8Array.from([...header, 2, 9, 1, 1, 101, 1, 109, 2, 1, 1, 2]),
			Uint8Array.from([...header, 5, 5, 2, 0, 1, 0, 1])
		]) {
			messages.length = 0;
			await (globalThis as any).onmessage({
				data: {
					code: Buffer.from(bytes).toString('base64'),
					prepare: true,
					maxWasmMemoryBytes: 1
				}
			});
			expect(messages).toEqual([{ results: true }]);
		}
	});
});
