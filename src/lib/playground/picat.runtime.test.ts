// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_NODE_PICAT === '1';
describe.skipIf(!enabled)('real pinned Picat engine in Node', () => {
	it(
		'runs the same verified VM, CP and SAT with bounded memory and stdio',
		{ timeout: 30000 },
		async () => {
			const base = new URL('../../../static/wasm-picat/', import.meta.url);
			const source = await readFile(new URL('picat.mjs', base), 'utf8');
			const factory = new Function(
				'require',
				'__filename',
				'__dirname',
				source.replace(/\nexport default PicatWasm;\n$/, '') + '\nreturn PicatWasm;'
			)(createRequire(import.meta.url), 'picat.cjs', '.');
			const worker = (
				await readFile(
					new URL(
						'../../../scripts/runtime-workers/wasm-picat-runner-worker.js',
						import.meta.url
					),
					'utf8'
				)
			).replace('__WASM_IDLE_PICAT_ASSET_LOCK__', '{}');
			const { boundPicatMemory } = new Function(
				'self',
				worker + '\nreturn {boundPicatMemory};'
			)({ postMessage() {} });
			const wasm = gunzipSync(await readFile(new URL('picat.wasm.gz.bin', base)));
			const data = gunzipSync(await readFile(new URL('picat.data.gz.bin', base)));
			const compiled = new WebAssembly.Module(boundPicatMemory(wasm, 128 * 1024 * 1024));
			for (const [program, input, expected] of [
				[editorDefaults.picat, 'Ada\n', 'Name? Hello, Ada\n'],
				[
					'main => println(read_line()), println(read_line()).',
					'Picat 안녕\n',
					'Picat 안녕\nend_of_file\n'
				],
				['import cp.\nmain => X :: 1..3, X #> 1, solve([X]), println(X).', '', '2\n'],
				['import sat.\nmain => X :: 0..1, X #= 1, solve([X]), println(X).', '', '1\n']
			]) {
				const stdin = new TextEncoder().encode(input);
				let position = 0;
				const output: number[] = [];
				const instance = await factory({
					instantiateWasm: (
						imports: WebAssembly.Imports,
						receive: (instance: WebAssembly.Instance) => void
					) => {
						const vm = new WebAssembly.Instance(compiled, imports);
						receive(vm);
						return vm.exports;
					},
					getPreloadedPackage: () => Uint8Array.from(data).buffer,
					locateFile: (name: string) => name,
					stdin: () => (position < stdin.length ? stdin[position++] : null),
					stdout: (value: number) => output.push(value),
					stderr: (value: number) => output.push(value)
				});
				instance.FS.writeFile('/user_code.pi', program);
				instance.ccall('browser_boot', null, ['string'], ['/lib2']);
				expect(instance.ccall('browser_rerun', 'number')).toBe(1);
				expect(new TextDecoder().decode(Uint8Array.from(output))).toBe(expected);
			}
		}
	);
});
