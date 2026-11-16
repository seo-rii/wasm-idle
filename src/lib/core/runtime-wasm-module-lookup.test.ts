// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	requestRuntimeWasmModule,
	runtimeWasmModuleCacheKey,
	serveRuntimeWasmModule,
	serveRuntimeWasmModuleWithLookup,
	RuntimeAssetCache,
	type RuntimeWasmModuleServiceOptions
} from '@wasm-idle/core';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const receipt = {
	bytes: wasm.byteLength,
	sha256: createHash('sha256').update(wasm).digest('hex')
};
const options = (
	override: Partial<RuntimeWasmModuleServiceOptions> = {}
): RuntimeWasmModuleServiceOptions => ({
	receipt,
	identity: 'trusted-bundled-profile-v1',
	compileKey: 'native-default-v1',
	maxAssetBytes: 32,
	...override
});
const ports: MessagePort[] = [];
let module: WebAssembly.Module;

/** The peer's end of a freshly served lookup port. */
function serve(override: Partial<RuntimeWasmModuleServiceOptions> = {}) {
	const channel = new MessageChannel() as unknown as globalThis.MessageChannel;
	ports.push(channel.port1, channel.port2);
	serveRuntimeWasmModuleWithLookup(channel.port2, options(override));
	return channel.port1;
}
const replies = (port: MessagePort, ...messages: unknown[]) =>
	new Promise<{ type?: string; module?: unknown; message?: string }[]>((resolve) => {
		const received: { type?: string }[] = [];
		port.onmessage = (event) => {
			received.push(event.data);
			if (received.length === messages.length) resolve(received);
		};
		for (const message of messages) port.postMessage(message);
	});

beforeEach(async () => {
	vi.stubGlobal('crypto', webcrypto);
	vi.stubGlobal('MessageChannel', MessageChannel);
	module = await WebAssembly.compile(wasm);
});
afterEach(() => {
	for (const port of ports.splice(0)) port.close();
	vi.unstubAllGlobals();
});

describe('runtime Wasm module lookup', () => {
	it('names the cache key the module service retains a compiled module under', async () => {
		const cache = new RuntimeAssetCache(),
			compile = vi.fn(async () => module);
		const channel = new MessageChannel() as unknown as globalThis.MessageChannel;
		ports.push(channel.port1, channel.port2);
		serveRuntimeWasmModule(channel.port2, options({ cache, compile }));
		await requestRuntimeWasmModule(Uint8Array.from(wasm), channel.port1);
		expect(cache.get(runtimeWasmModuleCacheKey(options()))).toBe(module);
		expect(
			cache.get(runtimeWasmModuleCacheKey(options({ compileKey: 'other' })))
		).toBeUndefined();
	});

	it('answers one lookup with a retained module so peers can skip downloading the bytes', async () => {
		const cache = new RuntimeAssetCache(),
			compile = vi.fn(async () => module);
		// A miss leaves the ordinary verified compile request available on the same port.
		const cold = serve({ cache, compile });
		expect(await replies(cold, { type: 'lookup' })).toEqual([{ type: 'miss' }]);
		await expect(requestRuntimeWasmModule(Uint8Array.from(wasm), cold)).resolves.toBeInstanceOf(
			WebAssembly.Module
		);
		const [warm] = await replies(serve({ cache, compile }), { type: 'lookup' });
		expect(warm?.type).toBe('module');
		expect(warm?.module).toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledOnce();
		// Lookups never cross authorization or memory profiles.
		for (const override of [{ identity: 'other-profile' }, { maxAssetBytes: 16 }])
			expect(
				await replies(serve({ cache, compile, ...override }), { type: 'lookup' })
			).toEqual([{ type: 'miss' }]);
	});

	it('keeps the ordinary protocol for peers that skip the lookup or decorate it', async () => {
		const cache = new RuntimeAssetCache(),
			compile = vi.fn(async () => module);
		await expect(
			requestRuntimeWasmModule(Uint8Array.from(wasm), serve({ cache, compile }))
		).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledOnce();
		const [decorated] = await replies(serve({ cache, compile }), { type: 'lookup', module });
		expect(decorated).toMatchObject({ type: 'error' });
		const repeated = await replies(serve(), { type: 'lookup' }, { type: 'lookup' });
		expect(repeated[0]).toEqual({ type: 'miss' });
		expect(repeated[1]).toMatchObject({ type: 'error' });
	});

	it('reports an invalid service configuration to the peer instead of throwing', async () => {
		const [miss, error] = await replies(
			serve({ maxAssetBytes: 4 }),
			{ type: 'lookup' },
			{ type: 'lookup' }
		).catch(() => []);
		expect(miss).toEqual({ type: 'miss' });
		expect(error).toMatchObject({ type: 'error' });
	});
});
