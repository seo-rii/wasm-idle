// Bundled by probe-clang-host-performance.mjs against the selected source tree.
import Runtime from '@probe/clang/artifact-runtime';
import { executeBrowserClangArtifact } from '@probe/clang/browser-execution';
import { compileVerifiedWasmAsset } from '@probe/core/verified-wasm';

self.onmessage = async ({ data: { origin, manifest, receipts, cache, checks, repeats } }) => {
	try {
		const loads = new Map<string, Promise<WebAssembly.Module>>();
		// Exercise the application's verified loader shape, whose cache is external
		// to Runtime.moduleCache. A private-cache identity check must not disable reuse.
		class VerifiedRuntime extends Runtime {
			getModule(url: string, progress?: { set(value: number): void }, signal?: AbortSignal) {
				let pending = loads.get(url);
				if (!pending) {
					pending = compileVerifiedWasmAsset(url, receipts[new URL(url).pathname], {
						fetch: fetch.bind(globalThis),
						signal,
						maxAssetBytes: 128 * 1024 * 1024,
						persistentCache: { enabled: false },
						onProgress: (loaded: number, total: number) => progress?.set(loaded / total)
					});
					loads.set(url, pending);
				}
				return pending;
			}
		}
		let diagnostics = '';
		const runtime = new VerifiedRuntime({
			runtimeBaseUrl: `${origin}/clang/`,
			manifest,
			persistentCache: { enabled: false },
			stdout: (text: string) => {
				diagnostics += text;
			}
		});
		runtime.cacheTranslationUnits = cache;
		await runtime.ready;
		let fileReadBytes = 0;
		const originalRead = runtime.memfs.getFileContents.bind(runtime.memfs);
		runtime.memfs.getFileContents = (path: string) => {
			const bytes = originalRead(path);
			fileReadBytes += bytes.byteLength;
			return bytes;
		};
		const assert = (condition: unknown, message: string) => {
			if (!condition) throw new Error(message);
		};
		const run = async (source: string, options: any, expected: string) => {
			diagnostics = '';
			const before = fileReadBytes;
			const start = performance.now();
			const artifact = await runtime.compileArtifact(source, options);
			const compileLinkMs = performance.now() - start;
			const result = await executeBrowserClangArtifact(artifact, { stdin: () => '9\n' });
			assert(
				result.exitCode === 0 && result.stdout === expected,
				`Unexpected output: ${JSON.stringify({ result, expected, diagnostics })}`
			);
			return {
				compileLinkMs,
				fileReadBytes: fileReadBytes - before,
				emittedBytes: artifact.bytes.byteLength
			};
		};
		const samples = [];
		const cppHelper =
			'#include <vector>\n#include <algorithm>\n#include <numeric>\nint helper(){std::vector<int> v{6,5,4,3,2,1};std::sort(v.begin(),v.end());return std::accumulate(v.begin(),v.end(),0);}';
		for (const language of ['C', 'CPP']) {
			const extension = language === 'C' ? 'c' : 'cpp';
			for (const multi of [false, true]) {
				const options = {
					language,
					activePath: `main.${extension}`,
					workspaceFiles: multi
						? [
								{
									path: `helper.${extension}`,
									content:
										language === 'C'
											? 'int helper(void){return 21;}'
											: cppHelper
								}
							]
						: []
				};
				for (let iteration = 0; iteration <= repeats; iteration++) {
					const source = `#include <stdio.h>\n${multi ? 'int helper(void);' : ''}\nint main(void){int n;scanf("%d",&n);printf("%d\\n",n+${multi ? 'helper()+' : ''}${iteration});return 0;}`;
					const result = await run(
						source,
						options,
						`${9 + (multi ? 21 : 0) + iteration}\n`
					);
					samples.push({ language, multi, iteration, ...result });
				}
			}
		}
		const validations: string[] = [];
		if (checks) {
			const options = {
				language: 'C',
				activePath: 'main.c',
				workspaceFiles: [
					{
						path: 'helper.c',
						content:
							'#if __has_include("optional.h")\n#include "optional.h"\n#else\n#define VALUE 7\n#endif\nint helper(void){return VALUE;}'
					}
				]
			};
			const source =
				'#include <stdio.h>\nint helper(void);int main(void){printf("%d\\n",helper());return 0;}';
			await run(source, options, '7\n');
			await run(
				source,
				{
					...options,
					workspaceFiles: [
						...options.workspaceFiles,
						{ path: 'optional.h', content: '#define VALUE 13' }
					]
				},
				'13\n'
			);
			await run(source, options, '7\n');
			validations.push('optional-header addition and removal');
			await run(
				source,
				{
					...options,
					compileArgs: ['-DVALUE=17'],
					workspaceFiles: [
						{ path: 'helper.c', content: 'int helper(void){return VALUE;}' }
					]
				},
				'17\n'
			);
			validations.push('compile flag invalidation');
			let failed = false;
			try {
				await runtime.compileArtifact('this is invalid C', options);
			} catch {
				failed = true;
			}
			assert(failed && !runtime.wasm, 'Failed rebuild published a stale executable');
			await run(source, options, '7\n');
			validations.push('failed rebuild and recovery');
			const stats = runtime.incrementalCompilationStats;
			assert(
				stats.hits > 0 && stats.misses > 0,
				'Public runtime did not compose the TU cache'
			);
			const debug = await runtime.compileArtifact(source, { ...options, debugMode: 'lldb' });
			assert(
				!debug.wasm && debug.debug?.kind === 'dwarf',
				'LLDB byte-only descriptor contract changed'
			);
			assert(
				JSON.stringify(runtime.incrementalCompilationStats) === JSON.stringify(stats),
				'LLDB used the TU cache'
			);
			validations.push('LLDB bypass and byte-only descriptor');
			const files: Set<string> = (runtime.memfs as any).filePaths;
			assert(
				[...files].filter((path) => /-[0-9a-f]+\.[^.]+\.tmp$/.test(path)).length === 0,
				'Compiler temporary files survived'
			);
			validations.push('compiler temporary-file cleanup');
		}
		self.postMessage({
			samples,
			validations,
			stats: runtime.incrementalCompilationStats,
			temporaryFiles: [...(runtime.memfs as any).filePaths].filter((path: string) =>
				path.endsWith('.tmp')
			).length
		});
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.stack : String(error) });
	}
};
