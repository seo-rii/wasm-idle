// @vitest-environment node

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

	async function compileWithWorkspace(
		workspaceFiles: Array<{ path: string; content: string | Uint8Array }>
	) {
		await import('./clang');
		await (globalThis as any).self.onmessage({
			data: { load: true, path: '/clang/', log: false }
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'int main(void) { return 0; }',
				buffer: new SharedArrayBuffer(1024),
				debugBuffer: new SharedArrayBuffer(1024),
				watchBuffer: new SharedArrayBuffer(1024),
				watchResultBuffer: new SharedArrayBuffer(1024),
				interrupt: new SharedArrayBuffer(1024),
				language: 'C',
				debugMode: 'lldb',
				activePath: 'main.c',
				workspaceFiles
			}
		});
	}

	it.each([
		{ name: 'string', content: '73\n' },
		{
			name: 'UTF-8 bytes with BOM, NUL and Unicode',
			content: new TextEncoder().encode('\uFEFF73\0 한글😀\n')
		}
	])('preserves $name auxiliary content in the LLDB string payload', async ({ content }) => {
		const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
		const original = new Uint8Array(bytes);
		const workspaceFiles = [{ path: 'data/input.txt', content }];
		const descriptor = {
			kind: 'dwarf',
			sourceRoot: '/workspace',
			moduleSha256: 'module-sha256',
			files: [
				{ path: '/workspace/data/input.txt', contentSha256: 'input-sha256' },
				{ path: '/workspace/main.c', contentSha256: 'source-sha256' }
			]
		};
		clangState.compileArtifact.mockResolvedValue({
			bytes: new Uint8Array(8),
			debug: descriptor
		});
		await compileWithWorkspace(workspaceFiles);
		const artifact = (globalThis as any).postMessage.mock.calls.find(
			([message]: any[]) => message.lldbArtifact
		)?.[0].lldbArtifact;
		expect(artifact).toBeDefined();
		expect(artifact.sources).toEqual([
			{
				path: '/workspace/data/input.txt',
				content: typeof content === 'string' ? content : '\uFEFF73\0 한글😀\n',
				contentSha256: 'input-sha256'
			},
			{
				path: '/workspace/main.c',
				content: 'int main(void) { return 0; }',
				contentSha256: 'source-sha256'
			}
		]);
		expect(new TextEncoder().encode(artifact.sources[0].content)).toEqual(original);
		expect(clangState.compileArtifact.mock.calls[0][1].workspaceFiles).toEqual([
			{
				path: 'data/input.txt',
				content: typeof content === 'string' ? content : '\uFEFF73\0 한글😀\n'
			}
		]);
		expect(workspaceFiles[0].content).toBe(content);
		expect(bytes).toEqual(original);
		expect(clangState.compileLinkRun).not.toHaveBeenCalled();
	});

	it('normalizes byte source and header files before compiling an LLDB artifact', async () => {
		const helper = '#include "helper.h"\nint helper(void) { return VALUE; }\n';
		const header = '\uFEFF#define VALUE 73\n// 한글😀\n';
		const helperBytes = new TextEncoder().encode(helper);
		const headerBytes = new TextEncoder().encode(header);
		const workspaceFiles = [
			{ path: 'helper.c', content: helperBytes },
			{ path: 'helper.h', content: headerBytes }
		];
		const originals = workspaceFiles.map(({ content }) => new Uint8Array(content));
		clangState.compileArtifact.mockImplementation(async (_code, options) => {
			if (
				options.workspaceFiles.some(
					({ content }: { content: unknown }) => typeof content !== 'string'
				)
			)
				throw new TypeError('compiler workspace content must be text');
			return {
				bytes: new Uint8Array(8),
				debug: {
					files: [
						{ path: '/workspace/helper.c', contentSha256: 'helper-sha256' },
						{ path: '/workspace/helper.h', contentSha256: 'header-sha256' }
					]
				}
			};
		});
		await compileWithWorkspace(workspaceFiles);
		expect(clangState.compileArtifact.mock.calls[0][1].workspaceFiles).toEqual([
			{ path: 'helper.c', content: helper },
			{ path: 'helper.h', content: header }
		]);
		const artifact = (globalThis as any).postMessage.mock.calls.find(
			([message]: any[]) => message.lldbArtifact
		)?.[0].lldbArtifact;
		expect(artifact).toBeDefined();
		expect(
			artifact.sources.map(({ content }: { content: string }) =>
				new TextEncoder().encode(content)
			)
		).toEqual(originals);
		expect(workspaceFiles.map(({ content }) => content)).toEqual(originals);
		expect(workspaceFiles[0].content).toBe(helperBytes);
		expect(workspaceFiles[1].content).toBe(headerBytes);
		expect(clangState.compileLinkRun).not.toHaveBeenCalled();
	});

	it('rejects invalid UTF-8 without replacing or mutating auxiliary file bytes', async () => {
		const content = new Uint8Array([0x37, 0x33, 0xff]);
		const workspaceFiles = [{ path: 'data/input.bin', content }];
		clangState.compileArtifact.mockResolvedValue({
			bytes: new Uint8Array(8),
			debug: { files: [] }
		});
		await compileWithWorkspace(workspaceFiles);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'LLDB workspace file is not valid UTF-8: /workspace/data/input.bin'
		});
		expect(
			(globalThis as any).postMessage.mock.calls.some(
				([message]: any[]) => message.lldbArtifact
			)
		).toBe(false);
		expect(clangState.compileArtifact).not.toHaveBeenCalled();
		expect(content).toEqual(new Uint8Array([0x37, 0x33, 0xff]));
		expect(clangState.compileLinkRun).not.toHaveBeenCalled();
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
