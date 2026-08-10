import { createHash } from 'node:crypto';
import { RUBY_RUNTIME_ASSET_PATH, type RubyRuntimeAssetReceipts } from '@wasm-idle/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadVerifiedRubyRuntimeAssets: vi.fn(),
	importRuntimeModule: vi.fn()
}));

vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/playground/rubyAssets')>()),
	loadVerifiedRubyRuntimeAssets: mocks.loadVerifiedRubyRuntimeAssets
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: mocks.importRuntimeModule
}));

const encoder = new TextEncoder();
const moduleSource = 'export const verified = true;';
const moduleBytes = encoder.encode(
	`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url);`
);
const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const integrity = {
	'runtime.mjs': receipt(moduleBytes),
	[RUBY_RUNTIME_ASSET_PATH]: receipt(wasmBytes)
} satisfies RubyRuntimeAssetReceipts;
const runtimeConfig = {
	moduleUrl: 'https://runtime.example/ruby/runtime.mjs?v=verified',
	wasmUrl: `https://runtime.example/ruby/${RUBY_RUNTIME_ASSET_PATH}?v=verified`,
	integrity,
	maxAssetBytes: 1_024
};
const runtimeModule = {
	RubyVM: {},
	consolePrinter() {},
	wasiShim: {}
};

const loadWorker = async () => {
	await import('./ruby');
	return (globalThis as any).self.onmessage as (event: { data: any }) => Promise<void>;
};

describe('Ruby execution worker asset boundary', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		mocks.loadVerifiedRubyRuntimeAssets.mockReset();
		mocks.importRuntimeModule.mockReset();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		mocks.loadVerifiedRubyRuntimeAssets.mockResolvedValue({
			config: runtimeConfig,
			moduleSource,
			wasmBytes
		});
		mocks.importRuntimeModule.mockResolvedValue(runtimeModule);
	});

	it('imports only the verified Blob source and compiles only verified Wasm bytes', async () => {
		let importedBlob: Blob | undefined;
		const blobUrl = 'blob:https://runtime.example/verified-ruby';
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			importedBlob = blob as Blob;
			return blobUrl;
		});
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const compiled = {} as WebAssembly.Module;
		const compile = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(compiled);
		const onmessage = await loadWorker();

		await onmessage({ data: { load: true, ...runtimeConfig, log: false } });

		expect(mocks.loadVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce();
		expect(mocks.loadVerifiedRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining(runtimeConfig)
		);
		expect(await importedBlob?.text()).toBe(moduleSource);
		expect(mocks.importRuntimeModule).toHaveBeenCalledWith(blobUrl);
		expect(compile).toHaveBeenCalledWith(wasmBytes);
		expect(revokeObjectUrl).toHaveBeenCalledWith(blobUrl);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('clears a failed verification promise so the same profile can retry cleanly', async () => {
		const failure = new Error('Ruby runtime module integrity failed');
		mocks.loadVerifiedRubyRuntimeAssets
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce({ config: runtimeConfig, moduleSource, wasmBytes });
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const onmessage = await loadWorker();

		await onmessage({ data: { load: true, ...runtimeConfig, log: false } });
		await onmessage({ data: { load: true, ...runtimeConfig, log: false } });

		expect(mocks.loadVerifiedRubyRuntimeAssets).toHaveBeenCalledTimes(2);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: failure.message
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('reuses verified bytes when only a looser host byte limit changes', async () => {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const onmessage = await loadWorker();

		await onmessage({ data: { load: true, ...runtimeConfig, log: false } });
		await onmessage({
			data: { load: true, ...runtimeConfig, maxAssetBytes: 2_048, log: false }
		});

		expect(mocks.loadVerifiedRubyRuntimeAssets).toHaveBeenCalledOnce();
		expect(WebAssembly.compile).toHaveBeenCalledOnce();
	});
});
