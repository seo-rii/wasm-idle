import { fileURLToPath } from 'node:url';

/** Bundle the core client into integrity-pinned classic or module runtime Workers.
 * @param {string} source
 * @returns {Promise<string>}
 */
export async function withRuntimeWasmModuleClient(source) {
	const { build } = await import('esbuild');
	const result = await build({
		stdin: {
			contents:
				"import { requestRuntimeWasmModule } from '../packages/core/src/runtime-wasm-module-service.ts'; globalThis.__wasmIdleRequestRuntimeWasmModule = requestRuntimeWasmModule;",
			resolveDir: fileURLToPath(new URL('./', import.meta.url)),
			sourcefile: 'runtime-wasm-module-client.js'
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		minify: true,
		legalComments: 'none'
	});
	return `${result.outputFiles[0].text}\n${source}`;
}
