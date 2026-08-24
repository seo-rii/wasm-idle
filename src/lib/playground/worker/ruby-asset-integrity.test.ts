import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	verifyRubyRuntimePreflightPayload: vi.fn(),
	rewriteVerifiedRubyRuntimeModule: vi.fn(),
	importRuntimeModule: vi.fn()
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRubyRuntimePreflightPayload: mocks.verifyRubyRuntimePreflightPayload,
	rewriteVerifiedRubyRuntimeModule: mocks.rewriteVerifiedRubyRuntimeModule
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: mocks.importRuntimeModule
}));

const payload = Object.freeze({
	protocol: 'wasm-idle-ruby-preflight',
	protocolVersion: 1,
	profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4',
	artifactRevision: '3'.repeat(40),
	rubyVersion: '3.4.1',
	rubyRevision: '4'.repeat(40),
	rubyWasmVersion: '2.9.3-2.9.4',
	rubyWasmRevision: '3'.repeat(40),
	wasiSdkVersion: '22.0',
	manifestFingerprint: '5'.repeat(64),
	manifestBytes: new Uint8Array([1]),
	moduleJavaScriptBytes: new Uint8Array([2]),
	wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
});
const moduleSource = 'export const verified = true;';
const runtimeModule = {
	RubyVM: {},
	consolePrinter() {},
	rubyStdlibWasmUrl: 'wasm-idle-verified:ruby/assets/ruby-stdlib.wasm',
	wasiShim: {}
};

const loadWorker = async () => {
	await import('./ruby');
	return (globalThis as any).self.onmessage as (event: { data: any }) => Promise<void>;
};

describe('Ruby execution worker verified-payload boundary', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		mocks.verifyRubyRuntimePreflightPayload.mockReset();
		mocks.rewriteVerifiedRubyRuntimeModule.mockReset();
		mocks.importRuntimeModule.mockReset();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(() => {
			throw new Error('Ruby execution worker must not fetch runtime assets');
		});
		mocks.verifyRubyRuntimePreflightPayload.mockResolvedValue(payload);
		mocks.rewriteVerifiedRubyRuntimeModule.mockReturnValue(moduleSource);
		mocks.importRuntimeModule.mockResolvedValue(runtimeModule);
	});

	it('reverifies the exact payload, imports only its Blob module, and compiles only explicit bytes', async () => {
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

		await onmessage({ data: { load: true, runtimePreflight: payload, maxAssetBytes: 1024 } });

		expect(mocks.verifyRubyRuntimePreflightPayload).toHaveBeenCalledWith(payload, {
			maxAssetBytes: 1024
		});
		expect(mocks.rewriteVerifiedRubyRuntimeModule).toHaveBeenCalledWith(payload);
		expect(await importedBlob?.text()).toBe(moduleSource);
		expect(mocks.importRuntimeModule).toHaveBeenCalledWith(blobUrl);
		expect(compile).toHaveBeenCalledWith(payload.wasmBytes);
		expect(revokeObjectUrl).toHaveBeenCalledWith(blobUrl);
		expect((globalThis as any).fetch).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('rejects duplicate load while ready and never reimports or recompiles the runtime', async () => {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const onmessage = await loadWorker();

		await onmessage({ data: { load: true, runtimePreflight: payload, maxAssetBytes: 1024 } });
		await onmessage({ data: { load: true, runtimePreflight: payload, maxAssetBytes: 1024 } });

		expect(mocks.verifyRubyRuntimePreflightPayload).toHaveBeenCalledOnce();
		expect(mocks.importRuntimeModule).toHaveBeenCalledOnce();
		expect(WebAssembly.compile).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Ruby runtime is already loaded.'
		});
	});

	it('clears a failed load state so a fresh verified payload can retry', async () => {
		mocks.verifyRubyRuntimePreflightPayload
			.mockRejectedValueOnce(new Error('payload rejected'))
			.mockResolvedValueOnce(payload);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const onmessage = await loadWorker();

		await onmessage({ data: { load: true, runtimePreflight: payload, maxAssetBytes: 1024 } });
		await onmessage({ data: { load: true, runtimePreflight: payload, maxAssetBytes: 1024 } });

		expect(mocks.verifyRubyRuntimePreflightPayload).toHaveBeenCalledTimes(2);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'payload rejected' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it.each([
		{ load: true, runtimePreflight: payload, maxAssetBytes: 0 },
		{ load: false, runtimePreflight: payload, maxAssetBytes: 1024 },
		{
			load: true,
			runtimePreflight: payload,
			maxAssetBytes: 1024,
			moduleUrl: 'https://legacy.example/runtime.mjs'
		},
		{
			load: true,
			runtimePreflight: payload,
			maxAssetBytes: 1024,
			integrity: {}
		}
	])('rejects widened or legacy load envelopes without verification', async (message) => {
		const onmessage = await loadWorker();

		await onmessage({ data: message });

		expect(mocks.verifyRubyRuntimePreflightPayload).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Ruby runtime load message has an invalid shape.'
		});
	});

	it.each([
		{
			name: 'partial manifest view',
			createPayload: () => {
				const backing = Uint8Array.of(1, 2);
				return Object.freeze({ ...payload, manifestBytes: backing.subarray(0, 1) });
			}
		},
		{
			name: 'shared backing buffer',
			createPayload: () =>
				Object.freeze({
					...payload,
					manifestBytes: new Uint8Array(new SharedArrayBuffer(1))
				})
		},
		{
			name: 'duplicate byte ownership',
			createPayload: () =>
				Object.freeze({ ...payload, moduleJavaScriptBytes: payload.manifestBytes })
		}
	])('rejects $name before module import or Wasm compilation', async ({ createPayload }) => {
		const candidate = createPayload();
		mocks.verifyRubyRuntimePreflightPayload.mockResolvedValueOnce(candidate);
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({} as WebAssembly.Module);
		const onmessage = await loadWorker();

		await onmessage({
			data: { load: true, runtimePreflight: candidate, maxAssetBytes: 1024 }
		});

		expect(mocks.rewriteVerifiedRubyRuntimeModule).not.toHaveBeenCalled();
		expect(mocks.importRuntimeModule).not.toHaveBeenCalled();
		expect(compile).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('owned runtime preflight bytes')
		});
	});
});
