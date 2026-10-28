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
		const captured = [
			['value', 'int', 'value'],
			['large', 'long', '9007199254740993L'],
			[
				'text',
				'String',
				String.raw`"x\n\000" + new java.lang.String(new char[]{0xd83d,0xde00})`
			],
			['array', 'int[]', 'new int[]{1,2}'],
			['opaque', 'SideEffect', 'new SideEffect()'],
			['character', 'char', String.raw`'\n'`],
			['negativeZero', 'double', 'Double.longBitsToDouble(Long.MIN_VALUE)'],
			['flag', 'boolean', 'true'],
			['boxed', 'var', 'java.lang.Integer.valueOf(7)'],
			['asObject', 'Object', '(Object) "target"'],
			['nullString', 'String', '(java.lang.String) null'],
			['nullReference', 'Object', '(Object) null'],
			['this', 'Main', 'new Main()']
		];
		compiler.addSourceFile(
			'Main.java',
			`public class Main {
  static int doubleValue(int value) {
    ${bridge.qualifiedName}.hit("Main.java", 3, 5, new String[]{${captured.map(([name]) => JSON.stringify(name)).join(',')}}, new String[]{${captured.map(([, type]) => JSON.stringify(type)).join(',')}}, new Object[]{${captured.map(([, , value]) => `${bridge.qualifiedName}.capture(${value})`).join(',')}});
    return value * 2;
  }
  static int recurse(int depth) {
    if (depth == 0) { ${bridge.qualifiedName}.hit("Main.java", 7, 5); return 0; }
    return 1 + recurse(depth - 1);
  }
  public static void main(String[] args) {
    System.out.println(doubleValue(7));
    System.out.println(recurse(80));
    if (SideEffect.calls != 0) throw new AssertionError("inspection called user toString");
  }
}
class SideEffect { static int calls; public String toString() { calls++; throw new RuntimeException(); } }`
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
		const replies: any[] = [];
		globals.window = globalThis;
		globals.wasmIdleJavaDebug = {
			poll: () => ({}),
			pause: (
				source: string,
				line: number,
				column: number,
				frames: string,
				rawDepth: number,
				variables: string,
				count: number
			) => {
				pauses.push({
					source,
					line,
					column,
					rawDepth,
					frames: JSON.parse(frames),
					variables: JSON.parse(variables),
					count
				});
				return pauses.length === 1 ? { op: 'context', id: 1, stopId: 1 } : null;
			},
			reply: (id: number, stopId: number, value: string | null, error: string | null) => {
				replies.push({
					id,
					stopId,
					value: value === null ? null : JSON.parse(value),
					error
				});
				return id === 1
					? {
							op: 'variables',
							id: 2,
							stopId: 1,
							reference: pauses[0].variables.find(
								(item: any) => item.name === 'array'
							).variablesReference,
							start: 1,
							count: 1
						}
					: null;
			}
		};
		try {
			let output = '';
			const app = await loader.load(
				new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm')),
				{
					stackDeobfuscator: {
						enabled: true,
						// The raw 0.16 loader compiles its own deobfuscator input.
						path: await read('compiler.wasm-deobfuscator.wasm'),
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
			expect(pauses[0].variables).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'value', value: '7', type: 'int' }),
					expect.objectContaining({
						name: 'large',
						value: '9007199254740993',
						type: 'long'
					}),
					expect.objectContaining({ name: 'array', indexedVariables: 2 }),
					expect.objectContaining({ name: 'negativeZero', value: '-0.0' }),
					expect.objectContaining({ name: 'flag', value: 'true' })
				])
			);
			expect(
				JSON.parse(pauses[0].variables.find((item: any) => item.name === 'text').value)
			).toBe('x\n\0😀');
			expect(replies[0]).toMatchObject({ id: 1, stopId: 1, error: null });
			expect(replies[0].value.bindings).toEqual(
				expect.arrayContaining([
					{ name: 'large', type: 'long', value: '9007199254740993' },
					{ name: 'character', type: 'char', value: '10' },
					{ name: 'text', type: 'java.lang.String', value: 'x\n\0😀' },
					{ name: 'nullString', type: 'java.lang.String', value: null },
					expect.objectContaining({
						name: 'boxed',
						type: 'var',
						unavailable: expect.any(String)
					}),
					expect.objectContaining({
						name: 'asObject',
						type: 'Object',
						unavailable: expect.any(String)
					}),
					expect.objectContaining({
						name: 'nullReference',
						type: 'Object',
						unavailable: expect.any(String)
					}),
					expect.objectContaining({ name: 'opaque', unavailable: expect.any(String) })
				])
			);
			expect(replies[0].value.bindings.some((binding: any) => binding.name === 'this')).toBe(
				false
			);
			expect(replies[1]).toMatchObject({
				id: 2,
				stopId: 1,
				error: null,
				value: [{ name: '[1]', type: 'int', value: '2', variablesReference: 0 }]
			});
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
