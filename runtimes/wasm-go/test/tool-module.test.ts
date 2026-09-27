import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGoToolModuleCache, compileGoToolModule } from '../src/tool-module.js';
import { executeGoToolInvocation } from '../src/tool-runtime.js';
import type { BrowserGoBuildPlan, BrowserGoToolInvocation } from '../src/types.js';

const command = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);
const page = 65_536;
function variant(id: number) {
	return new Uint8Array([...command, 0, 2, 1, id]);
}
const compile = (bytes = command, limit = page, signal?: AbortSignal) =>
	compileGoToolModule(bytes, limit, 'test.wasm', signal);
afterEach(() => {
	clearGoToolModuleCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('content-addressed Go tool modules', () => {
	it('deduplicates sequential and concurrent native compilation', async () => {
		const spy = vi.spyOn(WebAssembly, 'compile');
		const [a, b] = await Promise.all([compile(), compile(command.slice())]);
		expect(a).toBe(b);
		expect(await compile()).toBe(a);
		expect(spy).toHaveBeenCalledTimes(1);
	});
	it('creates a fresh instance and memory for each invocation', async () => {
		const module = await compile();
		const a = await WebAssembly.instantiate(module);
		const b = await WebAssembly.instantiate(await compile());
		new Uint8Array((a.exports.memory as WebAssembly.Memory).buffer)[0] = 23;
		expect(new Uint8Array((b.exports.memory as WebAssembly.Memory).buffer)[0]).toBe(0);
	});
	it('separates content and memory limits', async () => {
		const a = await compile();
		const b = await compile(command, page * 2);
		expect(a).not.toBe(b);
		expect(await compile(variant(65))).not.toBe(a);
		const capped = await WebAssembly.instantiate(a);
		expect(() => (capped.exports.memory as WebAssembly.Memory).grow(1)).toThrow(RangeError);
		const larger = await WebAssembly.instantiate(b);
		expect((larger.exports.memory as WebAssembly.Memory).grow(1)).toBe(1);
	});
	it('snapshots a nonzero-offset view before hashing and caller mutation', async () => {
		const storage = new Uint8Array(command.length + 12);
		storage.set(command, 5);
		const view = storage.subarray(5, 5 + command.length);
		const operation = compile(view);
		storage.fill(0);
		expect(await operation).toBe(await compile());
	});
	it('does not bypass a later stricter memory policy', async () => {
		await compile(command, page * 2);
		await expect(compile(command, page - 1)).rejects.toThrow(/memory limit/);
	});
	it('evicts rejected native compilations and permits retry', async () => {
		const spy = vi
			.spyOn(WebAssembly, 'compile')
			.mockRejectedValueOnce(new Error('compile failed'));
		await expect(compile()).rejects.toThrow('compile failed');
		expect(await compile()).toBeInstanceOf(WebAssembly.Module);
		expect(spy).toHaveBeenCalledTimes(2);
	});
	it('limits the LRU to four modules and refreshes hits', async () => {
		const spy = vi.spyOn(WebAssembly, 'compile');
		for (let id = 65; id < 69; id++) await compile(variant(id));
		await compile(variant(65));
		await compile(variant(69));
		await compile(variant(65));
		expect(spy).toHaveBeenCalledTimes(5);
		await compile(variant(66));
		expect(spy).toHaveBeenCalledTimes(6);
	});
	it('falls back to native compilation without Web Crypto', async () => {
		vi.stubGlobal('crypto', undefined);
		const spy = vi.spyOn(WebAssembly, 'compile');
		await compile();
		await compile();
		expect(spy).toHaveBeenCalledTimes(2);
	});
	it('rejects an early abort without compiling', async () => {
		const spy = vi.spyOn(WebAssembly, 'compile');
		const controller = new AbortController();
		controller.abort(new Error('cancel'));
		await expect(compile(command, page, controller.signal)).rejects.toThrow('cancel');
		expect(spy).not.toHaveBeenCalled();
	});
	it('cancels one waiter promptly without poisoning a peer or its cache', async () => {
		const nativeModule = await WebAssembly.compile(command);
		let resolve!: (module: WebAssembly.Module) => void;
		const pending = new Promise<WebAssembly.Module>((done) => {
			resolve = done;
		});
		const spy = vi.spyOn(WebAssembly, 'compile').mockReturnValue(pending);
		const controller = new AbortController();
		const a = compile(command, page, controller.signal);
		const assertion = expect(a).rejects.toThrow('cancel');
		const b = compile();
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		controller.abort(new Error('cancel'));
		await assertion;
		resolve(nativeModule);
		expect(await b).toBe(nativeModule);
		expect(await compile()).toBe(nativeModule);
	});
	it('does not retain an abort listener after cancellation of a stalled compile', async () => {
		vi.spyOn(WebAssembly, 'compile').mockReturnValue(new Promise(() => {}));
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		const operation = compile(command, page, controller.signal);
		const assertion = expect(operation).rejects.toThrow('cancel');
		await vi.waitFor(() => expect(WebAssembly.compile).toHaveBeenCalled());
		controller.abort(new Error('cancel'));
		await assertion;
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
	});
	it('still validates downloaded assets on a module cache hit', async () => {
		const invocation: BrowserGoToolInvocation = {
			tool: 'compile',
			argv0: 'compile',
			toolAsset: 'compile.wasm',
			args: ['compile'],
			env: {},
			inputFiles: [],
			outputPath: '/work/main.a'
		};
		const plan = { compile: invocation, sysrootFiles: [] } as unknown as BrowserGoBuildPlan;
		const fetchImpl = vi.fn(async () => new Response(command.slice().buffer));
		await executeGoToolInvocation(invocation, plan, 'https://example.test/', fetchImpl);
		await expect(
			executeGoToolInvocation(
				invocation,
				plan,
				'https://example.test/',
				fetchImpl,
				undefined,
				{ maxAssetBytes: command.length - 1 }
			)
		).rejects.toThrow(/asset limit/);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
