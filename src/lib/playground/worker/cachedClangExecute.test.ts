import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaygroundBinding, type Sandbox } from '@wasm-idle/core';
import { executeBrowserClangArtifact, type BrowserClangArtifact } from '@wasm-idle/llvm-core/clang';
import { createCachedClangSandbox } from '../cachedClang';
import type { RuntimeAssetCache } from '../runtimeAssetCache';
import type { ClangExecuteWorkerRequest, ClangExecuteWorkerResponse } from '../clangWorkerProtocol';

vi.mock('@wasm-idle/llvm-core/clang', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@wasm-idle/llvm-core/clang')>();
	return { ...actual, executeBrowserClangArtifact: vi.fn(actual.executeBrowserClangArtifact) };
});

// Valid WASI module exporting one-page bounded memory and a no-op _start.
const bytes = Uint8Array.from([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 1, 1, 2, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.resetModules();
});

describe('cached C/C++ execution filesystem', () => {
	it.each([
		{
			name: 'preserves supplied entry without active source',
			workspaceFiles: [{ path: 'main.c', content: 'provided source' }],
			code: undefined,
			error: false
		},
		{
			name: 'still rejects duplicate auxiliary files',
			workspaceFiles: [
				{ path: 'data.txt', content: 'first' },
				{ path: 'data.txt', content: 'second' }
			],
			code: 'active source',
			error: true
		}
	])('$name', async ({ workspaceFiles, code, error }) => {
		const posted = vi.fn();
		vi.stubGlobal('postMessage', posted);
		vi.stubGlobal('onmessage', null);
		await import('./cachedClangExecute');
		const handle = globalThis.onmessage as unknown as (event: {
			data: ClangExecuteWorkerRequest;
		}) => Promise<void>;
		await handle({
			data: {
				artifact: { bytes, target: 'wasm32-wasi', format: 'wasi-core-wasm', language: 'C' },
				workspaceFiles,
				code,
				stdin: '',
				inputBuffer: new SharedArrayBuffer(8)
			}
		});
		if (error) {
			expect(posted).toHaveBeenCalledWith({
				type: 'error',
				error: 'Duplicate guest file path: /data.txt'
			});
		} else {
			expect(posted).toHaveBeenCalledWith({ type: 'done', exitCode: 0 });
			expect(vi.mocked(executeBrowserClangArtifact).mock.calls[0][1]!.files).toEqual([
				{ path: 'main.c', contents: 'provided source' }
			]);
		}
	});

	it.each([
		{ language: 'C' as const, entry: 'main.c' },
		{ language: 'CPP' as const, entry: 'main.cc' },
		{ language: 'C' as const, entry: 'src/main.c', activePath: 'src/main.c' },
		{ language: 'C' as const, entry: 'main.c', omitEntry: true }
	])('executes $language $entry on a cache miss and hit', async (scenario) => {
		vi.stubGlobal('postMessage', vi.fn());
		vi.stubGlobal('onmessage', null);
		await import('./cachedClangExecute');
		const executeMessage = globalThis.onmessage as unknown as (event: {
			data: ClangExecuteWorkerRequest;
		}) => Promise<void>;
		let compilations = 0;
		const responses: ClangExecuteWorkerResponse[] = [];
		const artifact: BrowserClangArtifact = {
			bytes,
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm',
			language: scenario.language
		};

		class TestWorker {
			onmessage: ((event: { data: unknown }) => void) | null = null;
			constructor(private phase: 'compile' | 'execute') {}
			terminate() {}
			postMessage(data: ClangExecuteWorkerRequest) {
				if (this.phase === 'compile') {
					compilations += 1;
					queueMicrotask(() =>
						this.onmessage?.({ data: { type: 'compiled', artifact } })
					);
				} else {
					vi.stubGlobal('postMessage', (message: ClangExecuteWorkerResponse) => {
						responses.push(message);
						this.onmessage?.({ data: message });
					});
					void executeMessage({ data });
				}
			}
		}
		const legacy: Sandbox = {
			constructor: Object,
			eof() {},
			async load() {},
			async run() {
				return true;
			},
			terminate() {},
			async clear() {}
		};
		const cached = createCachedClangSandbox(
			legacy,
			scenario.language,
			{} as RuntimeAssetCache,
			undefined,
			{
				compile: () => new TestWorker('compile') as unknown as Worker,
				execute: () => new TestWorker('execute') as unknown as Worker
			}
		);
		const binding = createPlaygroundBinding(
			{ rootUrl: 'https://assets.example/repl-v1' },
			async () => cached
		);
		try {
			const sandbox = await binding.load(scenario.language);
			await sandbox.load();
			const code = 'int main(void) { return 0; }';
			const workspaceFiles = [{ path: 'data.txt', content: 'resource' }];
			if (!scenario.omitEntry)
				workspaceFiles.push({ path: scenario.entry, content: 'old code' });
			for (let index = 0; index < 2; index++) {
				await expect(
					sandbox.run(code, false, false, undefined, [], {
						stdin: '',
						workspaceFiles,
						activePath: scenario.activePath
					})
				).resolves.toBe(true);
			}
			expect(compilations).toBe(1);
			expect(responses).toEqual([
				{ type: 'done', exitCode: 0 },
				{ type: 'done', exitCode: 0 }
			]);
			for (const [, options] of vi.mocked(executeBrowserClangArtifact).mock.calls) {
				expect(options!.files).toEqual([
					{ path: 'data.txt', contents: 'resource' },
					{ path: scenario.entry, contents: code }
				]);
			}
		} finally {
			await binding.dispose();
		}
	});
});
