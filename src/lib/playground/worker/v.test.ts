// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	compile: vi.fn(),
	createVCompiler: vi.fn(),
	executeBrowserVArtifact: vi.fn(),
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: vi.fn(() => false),
	waitForBufferedStdin: vi.fn()
}));

vi.mock('@wasm-idle/llvm-core/v', () => ({
	createVCompiler: mocks.createVCompiler,
	executeBrowserVArtifact: mocks.executeBrowserVArtifact
}));

vi.mock('$lib/playground/worker/assets', () => ({
	configureWorkerRuntimeAssets: mocks.configureWorkerRuntimeAssets,
	handleWorkerAssetMessage: mocks.handleWorkerAssetMessage
}));

vi.mock('$lib/playground/stdinBuffer', () => ({
	waitForBufferedStdin: mocks.waitForBufferedStdin
}));

describe('V worker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		(globalThis as any).self = globalThis;
		(globalThis as any).postMessage = vi.fn();
		mocks.createVCompiler.mockResolvedValue({ compile: mocks.compile });
		mocks.compile.mockResolvedValue({
			success: true,
			artifact: { sourceLanguage: 'V' }
		});
		mocks.executeBrowserVArtifact.mockImplementation(async (_artifact, options) => {
			options.stdout(`stdin=${options.stdin()}`);
			return { exitCode: 0, stdout: '', stderr: '' };
		});
	});

	it('settles an empty source request without waiting for compilation', async () => {
		await import('./v');
		await (globalThis as any).self.onmessage({
			data: { code: '', prepare: true, log: false }
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('loads the V compiler through llvm-core, compiles workspace source, and executes stdin', async () => {
		await import('./v');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false,
				clangAssets: {
					baseUrl: '/wasm-clang/',
					maxAssetBytes: 4096,
					useAssetBridge: true
				},
				vBaseUrl: '/wasm-v/',
				maxAssetBytes: 4096
			}
		});

		const buffer = new SharedArrayBuffer(1024);
		await (globalThis as any).self.onmessage({
			data: {
				code: 'import os\n\nfn main() {\n\tprintln(os.get_line())\n}',
				buffer,
				stdin: '73\n',
				prepare: false,
				log: false,
				compileArgs: ['-skip-unused'],
				programArgs: ['demo'],
				activePath: 'src/main.v',
				workspaceFiles: [{ path: 'src/util.v', content: 'module main' }]
			}
		});

		expect(mocks.configureWorkerRuntimeAssets).toHaveBeenCalledWith({
			baseUrl: '/wasm-clang/',
			maxAssetBytes: 4096,
			useAssetBridge: true
		});
		expect(mocks.createVCompiler).toHaveBeenCalledWith({
			runtimeBaseUrl: '/wasm-v/',
			clangRuntimeBaseUrl: '/wasm-clang/',
			maxAssetBytes: 4096,
			log: false
		});
		expect(mocks.compile).toHaveBeenCalledWith(
			expect.objectContaining({
				fileName: 'src/main.v',
				compileArgs: ['-skip-unused'],
				workspaceFiles: [{ path: 'src/util.v', content: 'module main' }]
			})
		);
		expect(mocks.executeBrowserVArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ sourceLanguage: 'V' }),
			expect.objectContaining({ args: ['demo'] })
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'stdin=73\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reports V compiler diagnostics without executing a program', async () => {
		mocks.compile.mockResolvedValue({
			success: false,
			stderr: 'main.v:3:1: error: invalid expression: unexpected token `}`'
		});
		await import('./v');
		await (globalThis as any).self.onmessage({
			data: { load: true, log: false, vBaseUrl: '/wasm-v/', maxAssetBytes: 4096 }
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() {\n\tx := 1 +\n}',
				buffer: new SharedArrayBuffer(1024),
				prepare: false,
				log: false
			}
		});

		expect(mocks.executeBrowserVArtifact).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'main.v:3:1: error: invalid expression: unexpected token `}`'
		});
	});
});
