// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createJavaDebugBridge } from './javaDebugBridge';

it.skipIf(process.env.WASM_IDLE_RUN_JAVA_HOOKS !== '1')(
	'obtains real Java frames through the existing TeaVM JSO bridge without an extension',
	async () => {
		const root = new URL('../../../static/teavm/', import.meta.url);
		const read = async (file: string) =>
			Uint8Array.from(
				await readFile(new URL(file, root)).catch(async () =>
					gunzipSync(await readFile(new URL(`${file}.gz`, root)))
				)
			);
		const loader = await import(new URL('compiler.wasm-runtime.js', root).href);
		const compilerModule = await loader.load(await read('compiler.wasm'), {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		compiler.setSdk(new Int8Array(await read('compile-classlib-teavm.bin')));
		compiler.setTeaVMClasslib(new Int8Array(await read('runtime-classlib-teavm.bin')));
		const bridge = createJavaDebugBridge('ProbeBridge');
		const diagnostics: string[] = [];
		compiler.onDiagnostic((item: any) => diagnostics.push(String(item.message)));
		compiler.addSourceFile(bridge.sourceFileName, bridge.source);
		compiler.addSourceFile(
			'Main.java',
			`public class Main {
  static int doubleValue(int value) {
    ${bridge.qualifiedName}.hit("Main.java", 3, 5);
    return value * 2;
  }
  static int recurse(int depth) {
    if (depth == 0) { ${bridge.qualifiedName}.hit("Main.java", 7, 5); return 0; }
    return 1 + recurse(depth - 1);
  }
  public static void main(String[] args) {
    System.out.println(doubleValue(7));
    System.out.println(recurse(80));
  }
}`
		);
		expect(compiler.compile(), diagnostics.join('\n')).toBe(true);
		expect(
			compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' }),
			diagnostics.join('\n')
		).toBe(true);
		const globals = globalThis as any;
		const previousWindow = globals.window;
		const previousDebug = globals.wasmIdleJavaDebug;
		const pauses: any[] = [];
		globals.window = globalThis;
		globals.wasmIdleJavaDebug = {
			poll: () => ({}),
			pause: (
				source: string,
				line: number,
				column: number,
				frames: string,
				rawDepth: number
			) => pauses.push({ source, line, column, rawDepth, frames: JSON.parse(frames) })
		};
		try {
			let output = '';
			const app = await loader.load(
				new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm')),
				{
					stackDeobfuscator: {
						enabled: true,
						path: await (
							WebAssembly.compile as (
								bytes: BufferSource,
								options: { builtins: string[] }
							) => Promise<WebAssembly.Module>
						)((await read('compiler.wasm-deobfuscator.wasm')) as BufferSource, {
							builtins: ['js-string']
						}),
						infoLocation: 'embedded'
					},
					installImports(imports: any) {
						imports.teavmConsole.putcharStdout = (code: number) => {
							output += String.fromCharCode(code);
						};
					}
				}
			);
			const prepareStackTrace = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
			const stackTraceLimit = Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit');
			try {
				// Vitest's formatter omits Wasm frames; the shipped loader expects native V8 stacks.
				Reflect.deleteProperty(Error, 'prepareStackTrace');
				Error.stackTraceLimit = Infinity;
				app.exports.main([]);
			} finally {
				for (const [key, descriptor] of [
					['prepareStackTrace', prepareStackTrace],
					['stackTraceLimit', stackTraceLimit]
				] as const) {
					if (descriptor) Object.defineProperty(Error, key, descriptor);
					else Reflect.deleteProperty(Error, key);
				}
			}
			expect(output).toBe('14\n80\n');
			expect(pauses).toHaveLength(2);
			expect(pauses[1].rawDepth).toBeGreaterThan(80);
			expect(pauses[1].frames).toHaveLength(64);
			expect(pauses[0]).toMatchObject({ source: 'Main.java', line: 3 });
			expect(pauses[0].frames).toEqual(
				expect.arrayContaining([
					['Main', 'doubleValue', 'Main.java', 3],
					['Main', 'main', 'Main.java', 11]
				])
			);
		} finally {
			if (previousWindow === undefined) delete globals.window;
			else globals.window = previousWindow;
			if (previousDebug === undefined) delete globals.wasmIdleJavaDebug;
			else globals.wasmIdleJavaDebug = previousDebug;
		}
	},
	120_000
);
