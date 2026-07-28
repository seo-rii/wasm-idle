import { beforeEach, describe, expect, it, vi } from 'vitest';
import workerSource from './clang.ts?raw';

const clangState = vi.hoisted(() => ({
	compileArtifact: vi.fn(),
	compileLinkRun: vi.fn()
}));

vi.mock('@wasm-idle/llvm-core/clang', () => ({
	normalizeDwarfWorkspacePath(path: string) {
		const normalized = path
			.replaceAll('\\', '/')
			.split('/')
			.filter((part) => part && part !== '.' && part !== '..')
			.join('/');
		return normalized.startsWith('workspace/')
			? normalized.slice('workspace/'.length)
			: normalized;
	},
	loadRuntimeManifest: vi.fn(async () => ({})),
	resolveRuntimeManifestUrl: vi.fn((baseUrl: string) => `${baseUrl}runtime-manifest.v1.json`),
	BrowserClangRuntime: class {
		ready = Promise.resolve();
		log = false;

		compileArtifact(...args: unknown[]) {
			return clangState.compileArtifact(...args);
		}

		compileLinkRun(...args: unknown[]) {
			return clangState.compileLinkRun(...args);
		}
	}
}));

describe('Clang worker source', () => {
	it('waits for every compiler runtime module before reporting load completion', () => {
		expect(workerSource).toContain('await clang.ready;');
	});

	it('reports runtime load failures instead of leaving the host waiting', () => {
		expect(workerSource).toMatch(
			/if \(load\) \{[\s\S]*?try \{[\s\S]*?await loadClang[\s\S]*?catch/
		);
		expect(workerSource).toContain("error.message || 'Unable to load the C/C++ runtime.'");
	});

	it('reports source compilation separately from runtime loading', () => {
		expect(workerSource).toContain('postProgress(5, `Compiling ${language');
		expect(workerSource).toContain(
			"postProgress(100, `${language === 'C' ? 'C' : 'C++'} program ready`);"
		);
	});
});

describe('Clang worker LLDB sources', () => {
	beforeEach(() => {
		vi.resetModules();
		clangState.compileArtifact.mockReset();
		clangState.compileLinkRun.mockReset();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
	});

	it('uses the descriptor canonical paths for Windows and backtracking workspace paths', async () => {
		const source = '#include "../include/value.hpp"\nint main() { return value; }\n';
		const header = 'constexpr int value = 42;\n';
		const descriptor = {
			kind: 'dwarf' as const,
			sourceRoot: '/workspace' as const,
			moduleSha256: 'module-sha256',
			files: [
				{
					path: '/workspace/include/value.hpp',
					contentSha256: 'header-sha256'
				},
				{
					path: '/workspace/src/main.cpp',
					contentSha256: 'source-sha256'
				}
			],
			compiler: {
				name: 'clang' as const,
				version: '22.1.8',
				revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
			}
		};
		clangState.compileArtifact.mockResolvedValue({
			bytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm',
			debug: descriptor
		});

		await import('./clang');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				path: '/clang/',
				log: false
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: source,
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				debugBuffer: new SharedArrayBuffer(1024),
				watchBuffer: new SharedArrayBuffer(1024),
				watchResultBuffer: new SharedArrayBuffer(1024),
				interrupt: new SharedArrayBuffer(1024),
				language: 'CPP',
				debugMode: 'lldb',
				activePath: '\\workspace\\src\\..\\main.cpp',
				workspaceFiles: [
					{
						path: '\\workspace\\src\\..\\main.cpp',
						content: 'stale active source'
					},
					{
						path: '\\workspace\\include\\..\\value.hpp',
						content: header
					}
				]
			}
		});

		expect(clangState.compileLinkRun).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			lldbArtifact: {
				bytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
				descriptor,
				sources: [
					{
						path: '/workspace/include/value.hpp',
						content: header,
						contentSha256: 'header-sha256'
					},
					{
						path: '/workspace/src/main.cpp',
						content: source,
						contentSha256: 'source-sha256'
					}
				]
			}
		});
	});
});
