// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createRuntimeWasmModuleService,
	createPreparedRuntimeWasmModuleService,
	requestRuntimeWasmModule,
	requestPreparedRuntimeWasmModule,
	serveRuntimeWasmModule,
	RuntimeAssetCache,
	type RuntimeWasmModuleService,
	type RuntimeWasmModuleServiceOptions
} from '@wasm-idle/core';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = {
	bytes: wasm.byteLength,
	sha256: createHash('sha256').update(wasm).digest('hex')
};
const services: Pick<RuntimeWasmModuleService, 'close'>[] = [];
let module: WebAssembly.Module;

const options = (
	override: Partial<RuntimeWasmModuleServiceOptions> = {}
): RuntimeWasmModuleServiceOptions => ({
	receipt,
	identity: 'trusted-bundled-profile-v1',
	compileKey: 'native-default-v1',
	maxAssetBytes: 32,
	...override
});

const service = (override: Partial<RuntimeWasmModuleServiceOptions> = {}) => {
	const result = createRuntimeWasmModuleService(options(override));
	services.push(result);
	return result;
};

const request = (override: Partial<RuntimeWasmModuleServiceOptions> = {}) =>
	requestRuntimeWasmModule(Uint8Array.from(wasm), service(override).port);

beforeEach(async () => {
	vi.stubGlobal('crypto', webcrypto);
	vi.stubGlobal('MessageChannel', MessageChannel);
	module = await WebAssembly.compile(wasm);
});

afterEach(() => {
	for (const current of services.splice(0)) current.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('host runtime Wasm module service', () => {
	it('prepared endpoints snapshot owner bytes and reuse modules without receiving executable bytes', async () => {
		const cache = new RuntimeAssetCache(), compile = vi.fn(async () => module);
		const expected = options({ cache, compile });
		for (let index = 0; index < 2; index++) {
			const source = Buffer.from(wasm);
			const current = createPreparedRuntimeWasmModuleService({ ...expected, bytes: source });
			services.push(current); source.fill(255);
			await expect(requestPreparedRuntimeWasmModule(current.port, expected)).resolves.toBeInstanceOf(WebAssembly.Module);
		}
		expect(compile).toHaveBeenCalledOnce();
		const corrupt = Uint8Array.from(wasm); corrupt[7] = 1;
		const denied = createPreparedRuntimeWasmModuleService({ ...expected, bytes: corrupt }); services.push(denied);
		await expect(requestPreparedRuntimeWasmModule(denied.port, expected)).rejects.toThrow('integrity mismatch');
		expect(compile).toHaveBeenCalledOnce();
	});

	it.each(['receipt', 'identity', 'compileKey', 'maxAssetBytes'] as const)('prepared clients reject a mismatched %s', async field => {
		const expected = options();
		const current = createPreparedRuntimeWasmModuleService({ ...expected, bytes: wasm }); services.push(current);
		const wrong = { ...expected, [field]: field === 'receipt' ? { ...receipt, sha256: '0'.repeat(64) } : field === 'maxAssetBytes' ? 16 : 'other-profile' };
		await expect(requestPreparedRuntimeWasmModule(current.port, wrong)).rejects.toThrow('receipt or profile mismatch');
	});

	it('prepared cancellation drops in-flight compilation without publishing a late native result', async () => {
		const cache = new RuntimeAssetCache(), controller = new AbortController();
		let resume!: (value: WebAssembly.Module) => void;
		const compile = vi.fn(() => new Promise<WebAssembly.Module>(resolve => { resume = resolve; }));
		const expected = options({ cache, compile, signal: controller.signal });
		const current = createPreparedRuntimeWasmModuleService({ ...expected, bytes: wasm }); services.push(current);
		const pending = requestPreparedRuntimeWasmModule(current.port, expected), rejected = expect(pending).rejects.toThrow('retired');
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		controller.abort(new Error('retired')); await rejected; resume(module);
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(cache.stats()).toMatchObject({ entries: 0, inFlight: 0 });
	});

	it('cancellation holds a verification slot until the native digest settles', async () => {
		const controller = new AbortController(), release = vi.fn();
		let entered!: () => void, resume!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const gate = new Promise<void>(resolve => { resume = resolve; });
		const digest = crypto.subtle.digest.bind(crypto.subtle);
		vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { entered(); await gate; return digest(...args); });
		const expected = options({ signal: controller.signal, acquireVerificationSlot: async () => release });
		const current = createPreparedRuntimeWasmModuleService({ ...expected, bytes: wasm }); services.push(current);
		const pending = requestPreparedRuntimeWasmModule(current.port, expected), rejected = expect(pending).rejects.toThrow('retired');
		try {
			await started; controller.abort(new Error('retired')); await rejected;
			expect(release).not.toHaveBeenCalled(); resume();
			await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
		} finally { resume(); }
	});

	it('prepared endpoints reject peer-supplied modules and pins', async () => {
		const compile = vi.fn(async () => module);
		for (const message of [{ type: 'prepare', module, sha256: receipt.sha256 }, { type: 'compile', bytes: wasm.buffer }]) {
			const current = createPreparedRuntimeWasmModuleService({ ...options({ compile }), bytes: wasm }); services.push(current);
			const reply = new Promise(resolve => { current.port.onmessage = event => resolve(event.data); });
			current.port.postMessage(message);
			await expect(reply).resolves.toMatchObject({ type: 'error', message: 'Invalid runtime Wasm module request' });
		}
		expect(compile).not.toHaveBeenCalled();
	});

	it('reuses a verified immutable module while rechecking bytes on every cache hit', async () => {
		const cache = new RuntimeAssetCache();
		const compile = vi.fn(async () => module);
		await expect(request({ cache, compile })).resolves.toBeInstanceOf(WebAssembly.Module);
		await expect(request({ cache, compile })).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledOnce();
		const corrupt = Uint8Array.from(wasm);
		corrupt[corrupt.length - 1] = 1;
		await expect(
			requestRuntimeWasmModule(corrupt, service({ cache, compile }).port)
		).rejects.toThrow('integrity mismatch');
		expect(compile).toHaveBeenCalledOnce();
		expect(cache.stats()).toMatchObject({ entries: 1, inFlight: 0 });
	});

	it('snapshots host receipts and never accepts a peer-supplied hash or module', async () => {
		const pinned = { ...receipt };
		const compile = vi.fn(async () => module);
		const current = service({ receipt: pinned, compile });
		pinned.sha256 = '0'.repeat(64);
		await expect(
			requestRuntimeWasmModule(Uint8Array.from(wasm), current.port)
		).resolves.toBeInstanceOf(WebAssembly.Module);
		const denied = service({ compile });
		const reply = new Promise<{ type: string; message?: string }>((resolve) => {
			denied.port.onmessage = (event) => resolve(event.data);
		});
		denied.port.postMessage({ type: 'compile', module, sha256: receipt.sha256 });
		await expect(reply).resolves.toMatchObject({
			type: 'error',
			message: 'Invalid runtime Wasm module request'
		});
		expect(compile).toHaveBeenCalledOnce();
	});

	it('isolates authorization profiles, compilation options and memory limits', async () => {
		const cache = new RuntimeAssetCache();
		const compile = vi.fn(async () => module);
		const variants = [
			{},
			{ identity: 'custom-loader-other-trust-profile' },
			{ compileKey: 'transform-v2:builtins=js-string:memory=65536' },
			{ maxAssetBytes: 16 }
		];
		for (const variant of variants) {
			await request({ cache, compile, ...variant });
			await request({ cache, compile, ...variant });
		}
		expect(compile).toHaveBeenCalledTimes(4);
		expect(cache.stats().entries).toBe(4);
	});

	it('rejects oversized receipts and incorrect request lengths before compilation', async () => {
		const compile = vi.fn(async () => module);
		expect(() => service({ maxAssetBytes: 7, compile })).toThrow('asset limit');
		expect(() => service({ receipt: { ...receipt, bytes: -1 }, compile })).toThrow('invalid');
		expect(() => service({ receipt: { ...receipt, sha256: 'bad' }, compile })).toThrow(
			'invalid'
		);
		await expect(
			requestRuntimeWasmModule(new Uint8Array(9), service({ compile }).port)
		).rejects.toThrow('Invalid runtime Wasm module request');
		expect(compile).not.toHaveBeenCalled();
	});

	it('allows cancelling one worker without cancelling another subscriber', async () => {
		const cache = new RuntimeAssetCache();
		const share = vi.spyOn(cache, 'share');
		let resolveCompile!: (value: WebAssembly.Module) => void;
		const compile = vi.fn(
			() => new Promise<WebAssembly.Module>((resolve) => (resolveCompile = resolve))
		);
		const first = new AbortController();
		const cancelled = requestRuntimeWasmModule(
			Uint8Array.from(wasm),
			service({ cache, compile }).port,
			{ signal: first.signal }
		);
		const rejected = expect(cancelled).rejects.toThrow('worker retired');
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		const next = request({ cache, compile });
		await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
		first.abort(new Error('worker retired'));
		await rejected;
		resolveCompile(module);
		await expect(next).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledOnce();
		expect(cache.stats()).toMatchObject({ entries: 1, inFlight: 0 });
	});

	it('does not publish an abandoned native compilation and permits a fresh retry', async () => {
		const cache = new RuntimeAssetCache();
		const publish = vi.spyOn(cache, 'set');
		let resolveCompile!: (value: WebAssembly.Module) => void;
		const compile = vi.fn(
			() => new Promise<WebAssembly.Module>((resolve) => (resolveCompile = resolve))
		);
		const controller = new AbortController();
		const cancelled = requestRuntimeWasmModule(
			Uint8Array.from(wasm),
			service({ cache, compile, signal: controller.signal }).port,
			{ signal: controller.signal }
		);
		const rejected = expect(cancelled).rejects.toThrow('worker retired');
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		controller.abort(new Error('worker retired'));
		await rejected;
		expect(cache.stats().inFlight).toBe(0);
		resolveCompile(module);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(publish).not.toHaveBeenCalled();
		await expect(request({ cache })).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(cache.stats().entries).toBe(1);
	});

	it('does not retain failed compilations or exceed the cache retention budget', async () => {
		const cache = new RuntimeAssetCache(1024, 1);
		const compile = vi
			.fn<NonNullable<RuntimeWasmModuleServiceOptions['compile']>>()
			.mockRejectedValueOnce(new Error('native compile failed'))
			.mockResolvedValue(module);
		await expect(request({ cache, compile })).rejects.toThrow('native compile failed');
		expect(cache.stats()).toMatchObject({ entries: 0, inFlight: 0 });
		await request({ cache, compile });
		await request({ cache, compile, identity: 'second-profile' });
		await request({ cache, compile });
		expect(compile).toHaveBeenCalledTimes(4);
		expect(cache.stats().entries).toBe(1);
		expect(cache.stats().bytes).toBeLessThanOrEqual(1024);
		const disabled = new RuntimeAssetCache(0, 0);
		await expect(request({ cache: disabled })).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(disabled.stats()).toMatchObject({ entries: 0, bytes: 0, inFlight: 0 });
	});

	it('serves an endpoint transferred through a worker control channel', async () => {
		const channel = new MessageChannel();
		const broker = serveRuntimeWasmModule(channel.port1 as unknown as MessagePort, options());
		services.push(broker);
		await expect(
			requestRuntimeWasmModule(Uint8Array.from(wasm), channel.port2 as unknown as MessagePort)
		).resolves.toBeInstanceOf(WebAssembly.Module);
	});
});

class TestPort {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	postMessage = vi.fn();
	start = vi.fn();
	close = vi.fn();
}

describe('runtime Wasm module client cleanup', () => {
	it.each(['malformed', 'messageerror', 'posterror'] as const)(
		'settles and clears the port after %s',
		async (kind) => {
			const port = new TestPort();
			const signal = new AbortController().signal;
			const remove = vi.spyOn(signal, 'removeEventListener');
			if (kind === 'posterror')
				port.postMessage.mockImplementation(() => {
					throw new Error('closed peer');
				});
			const pending = requestRuntimeWasmModule(
				Uint8Array.from(wasm),
				port as unknown as MessagePort,
				{ signal }
			);
			const rejected = expect(pending).rejects.toThrow();
			if (kind === 'malformed')
				port.onmessage?.({ data: { type: 'module', module: {} } } as MessageEvent);
			if (kind === 'messageerror') port.onmessageerror?.();
			await rejected;
			expect(port.onmessage).toBeNull();
			expect(port.onmessageerror).toBeNull();
			expect(port.close).toHaveBeenCalledOnce();
			expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
		}
	);

	it('signals cancellation and closes an unresponsive service after its deadline', async () => {
		const port = new TestPort();
		await expect(
			requestRuntimeWasmModule(Uint8Array.from(wasm), port as unknown as MessagePort, {
				timeoutMs: 1
			})
		).rejects.toThrow('timed out');
		expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'cancel' });
		expect(port.close).toHaveBeenCalledOnce();
	});

	it('does not transfer compiler bytes after cancellation already happened', async () => {
		const port = new TestPort();
		const controller = new AbortController();
		controller.abort(new Error('obsolete run'));
		await expect(
			requestRuntimeWasmModule(Uint8Array.from(wasm), port as unknown as MessagePort, {
				signal: controller.signal
			})
		).rejects.toThrow('obsolete run');
		expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'cancel' });
		expect(port.close).toHaveBeenCalledOnce();
	});

	it('settles an invalid response even when native port cleanup throws', async () => {
		const port = new TestPort();
		port.close.mockImplementation(() => {
			throw new Error('port already retired');
		});
		const pending = requestRuntimeWasmModule(
			Uint8Array.from(wasm),
			port as unknown as MessagePort
		);
		const rejected = expect(pending).rejects.toThrow('Invalid runtime Wasm module response');
		port.onmessage?.({ data: null } as MessageEvent);
		await rejected;
		expect(port.onmessage).toBeNull();
		expect(port.onmessageerror).toBeNull();
	});
});
