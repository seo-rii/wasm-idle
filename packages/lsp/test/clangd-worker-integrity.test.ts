import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	decompressGzip: vi.fn(),
	verifyRuntimeAssetIntegrity: vi.fn()
}));

vi.mock('@wasm-idle/llvm-core', () => ({
	decompressGzip: mocks.decompressGzip
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRuntimeAssetIntegrity: mocks.verifyRuntimeAssetIntegrity
}));

class FakeClangdWorkerScope {
	readonly messages: unknown[] = [];
	private messageListener?: (event: MessageEvent) => void | Promise<void>;

	addEventListener(type: 'message', listener: (event: MessageEvent) => void | Promise<void>) {
		if (type === 'message') this.messageListener = listener;
	}

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	async dispatch(data: unknown) {
		await this.messageListener?.({ data } as MessageEvent);
	}
}

describe('clangd worker asset integrity', () => {
	let scope: FakeClangdWorkerScope;
	let getRegisterCalls: () => unknown[][];

	beforeEach(async () => {
		vi.resetModules();
		mocks.decompressGzip.mockReset();
		mocks.verifyRuntimeAssetIntegrity.mockReset();
		scope = new FakeClangdWorkerScope();
		vi.stubGlobal('self', scope);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clangd-runtime');
		const { ClangdWorkspaceFileRegistry } = await import('../src/clangd/workspace.js');
		const registerWorkspaceFile = vi.spyOn(ClangdWorkspaceFileRegistry.prototype, 'register');
		getRegisterCalls = () => registerWorkspaceFile.mock.calls;
		await import('../src/clangd/worker.js');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('rejects initialization without an explicit asset base URL', async () => {
		await scope.dispatch({
			type: 'init',
			assets: {
				clangdJs: new ArrayBuffer(0),
				clangdWasmGz: new ArrayBuffer(0)
			}
		});

		expect(scope.messages).toContainEqual({
			type: 'error',
			message: 'clangd init requires an explicit baseUrl'
		});
		expect(mocks.decompressGzip).not.toHaveBeenCalled();
	});

	it.each([
		'/workspace/../../usr/include/injected.hpp',
		'/workspaceevil/prefix.cpp',
		'/tmp/outside.cpp',
		'file:///workspace/remote.cpp',
		'include/./nested.hpp',
		'include/bad\0.hpp',
		42
	])('rejects an unsafe direct sync-file message for %s', async (path) => {
		await scope.dispatch({ type: 'sync-file', name: path });

		expect(scope.messages).toEqual([
			{
				type: 'error',
				message: expect.stringContaining('Failed to sync clangd workspace file')
			}
		]);
	});

	it('validates but does not reserve a workspace file before runtime initialization', async () => {
		await scope.dispatch({ type: 'sync-file', name: 'include\\header.hpp' });

		expect(scope.messages).toEqual([]);
		expect(getRegisterCalls()).toHaveLength(0);
	});

	it('verifies decompressed Wasm bytes before importing the runtime module', async () => {
		const runtimeBytes = Uint8Array.of(0, 97, 115, 109);
		const deliveryBytes = Uint8Array.of(0x1f, 0x8b, 0x08);
		const integrity = {
			bytes: deliveryBytes.byteLength,
			sha256: 'a'.repeat(64),
			uncompressedBytes: runtimeBytes.byteLength,
			uncompressedSha256: 'b'.repeat(64)
		};
		mocks.decompressGzip.mockResolvedValue(runtimeBytes);
		mocks.verifyRuntimeAssetIntegrity.mockRejectedValue(
			new Error('decompressed clangd Wasm failed integrity verification')
		);

		await scope.dispatch({
			type: 'init',
			baseUrl: 'https://assets.example.com/clangd/',
			assets: {
				clangdJs: new TextEncoder().encode('export default async () => ({})').buffer,
				clangdWasmGz: deliveryBytes.buffer,
				clangdWasmIntegrity: integrity
			}
		});

		expect(mocks.decompressGzip).toHaveBeenCalledWith(
			expect.objectContaining({ byteLength: deliveryBytes.byteLength }),
			'clangd.wasm.gz'
		);
		expect(mocks.verifyRuntimeAssetIntegrity).toHaveBeenCalledWith({
			asset: 'clangd.wasm.gz',
			bytes: runtimeBytes,
			expected: integrity,
			stage: 'uncompressed',
			mimeType: 'application/wasm',
			runtimeId: 'clangd'
		});
		expect(scope.messages).toContainEqual({
			type: 'error',
			message: 'decompressed clangd Wasm failed integrity verification'
		});
		expect(scope.messages).not.toContainEqual(expect.objectContaining({ type: 'ready' }));
	});
});
