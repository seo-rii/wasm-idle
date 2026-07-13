import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	compile: vi.fn(),
	createCobolCompiler: vi.fn(),
	executeBrowserCobolArtifact: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	waitForBufferedStdin: vi.fn()
}));

vi.mock('@seo-rii/wasm-llvm/runtime/cobol', () => ({
	createCobolCompiler: mocks.createCobolCompiler,
	executeBrowserCobolArtifact: mocks.executeBrowserCobolArtifact
}));

vi.mock('$lib/playground/worker/assets', () => ({
	configureWorkerRuntimeAssets: mocks.configureWorkerRuntimeAssets,
	handleWorkerAssetMessage: mocks.handleWorkerAssetMessage
}));

vi.mock('$lib/playground/stdinBuffer', () => ({
	waitForBufferedStdin: mocks.waitForBufferedStdin
}));

describe('COBOL worker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		(globalThis as any).self = globalThis;
		(globalThis as any).postMessage = vi.fn();
		mocks.createCobolCompiler.mockResolvedValue({ compile: mocks.compile });
		mocks.compile.mockResolvedValue({
			success: true,
			artifact: { sourceLanguage: 'COBOL' }
		});
		mocks.executeBrowserCobolArtifact.mockImplementation(async (_artifact, options) => {
			options.stdout(`stdin=${options.stdin()}`);
			return { exitCode: 0, stdout: '', stderr: '' };
		});
	});

	it('loads GnuCOBOL through wasm-llvm, compiles workspace source, and executes stdin', async () => {
		await import('./cobol');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: { baseUrl: '/wasm-clang/', useAssetBridge: true },
				cobolBaseUrl: '/wasm-cobol/'
			}
		});

		const buffer = new SharedArrayBuffer(1024);
		await (globalThis as any).self.onmessage({
			data: {
				code: 'identification division.\nprogram-id. main.\nprocedure division.\nstop run.',
				buffer,
				stdin: '73\n',
				prepare: false,
				log: false,
				compileArgs: ['-Wall'],
				programArgs: ['demo'],
				activePath: 'src/main.cob',
				workspaceFiles: [{ path: 'copy/demo.cpy', content: '01 VALUE PIC 9.' }]
			}
		});

		expect(mocks.configureWorkerRuntimeAssets).toHaveBeenCalledWith({
			baseUrl: '/wasm-clang/',
			useAssetBridge: true
		});
		expect(mocks.createCobolCompiler).toHaveBeenCalledWith({
			runtimeBaseUrl: '/wasm-cobol/',
			clangRuntimeBaseUrl: '/wasm-clang/',
			log: false
		});
		expect(mocks.compile).toHaveBeenCalledWith(
			expect.objectContaining({
				fileName: 'src/main.cob',
				sourceFormat: 'free',
				compileArgs: ['-Wall'],
				workspaceFiles: [{ path: 'copy/demo.cpy', content: '01 VALUE PIC 9.' }]
			})
		);
		expect(mocks.executeBrowserCobolArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ sourceLanguage: 'COBOL' }),
			expect.objectContaining({ args: ['demo'] })
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'stdin=73\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
