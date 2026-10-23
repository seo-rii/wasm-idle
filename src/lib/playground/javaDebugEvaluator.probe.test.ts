// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import {
	buildJavaDebugEvaluationProgram,
	type JavaDebugEvaluationRequest
} from './worker/javaDebugEvaluator';

interface JavaDebugEvaluatorCompiler {
	clearSourceFiles(): void;
	clearInputClassFiles(): void;
	clearOutputFiles(): void;
	addSourceFile(path: string, source: string): void;
	onDiagnostic(
		callback: (diagnostic: { message?: unknown }) => void
	): { destroy(): void } | (() => void) | void;
	compile(): boolean;
	generateWebAssembly(options: { outputName: string; mainClass: string }): boolean;
	getWebAssemblyOutputFile(path: string): ArrayLike<number> | null;
}
type JavaDebugEvaluatorRuntimeLoad = (
	bytes: Uint8Array,
	options: {
		stackDeobfuscator: { enabled: false };
		installImports(imports: {
			teavmConsole: {
				putcharStdout: (code: number) => void;
				putcharStderr: (code: number) => void;
			};
		}): void;
	}
) => Promise<{ exports: { main(args: string[]): unknown } }>;

/** Compile and execute the generated standalone program with the real shipped toolchain. */
async function evaluateSnapshot(
	compiler: JavaDebugEvaluatorCompiler,
	runtimeLoad: JavaDebugEvaluatorRuntimeLoad,
	request: JavaDebugEvaluationRequest
): Promise<string> {
	const program = buildJavaDebugEvaluationProgram(request);
	let registration: ReturnType<JavaDebugEvaluatorCompiler['onDiagnostic']> = undefined;
	const diagnostics: string[] = [];
	let diagnosticLength = 0;
	try {
		compiler.clearSourceFiles();
		compiler.clearInputClassFiles();
		compiler.clearOutputFiles();
		registration = compiler.onDiagnostic((item) => {
			if (diagnosticLength >= 16384) return;
			const message = String(item.message ?? '').slice(0, 16384 - diagnosticLength);
			diagnosticLength += message.length;
			diagnostics.push(message);
		});
		const mainClass = /^public final class ([A-Za-z0-9_]+)/.exec(program.code)![1];
		compiler.addSourceFile(`${mainClass}.java`, program.code);
		if (
			!compiler.compile() ||
			!compiler.generateWebAssembly({ outputName: 'evaluation', mainClass })
		)
			throw new Error(`Java expression compilation failed: ${diagnostics.join('\n')}`);
		const bytes = compiler.getWebAssemblyOutputFile('evaluation.wasm');
		if (!bytes) throw new Error('The Java compiler did not return an evaluator module.');
		let output = '';
		const append = (code: number) => {
			if (output.length >= 16384)
				throw new Error('Java evaluation output exceeds 16384 characters.');
			output += String.fromCharCode(code);
		};
		const runtime = await runtimeLoad(Uint8Array.from(bytes), {
			stackDeobfuscator: { enabled: false },
			installImports(imports) {
				imports.teavmConsole.putcharStdout = append;
				imports.teavmConsole.putcharStderr = append;
			}
		});
		await runtime.exports.main(program.args);
		return output;
	} finally {
		if (typeof registration === 'function') registration();
		else registration?.destroy();
		compiler.clearSourceFiles();
		compiler.clearInputClassFiles();
		compiler.clearOutputFiles();
	}
}

it.skipIf(process.env.WASM_IDLE_RUN_JAVA_EVALUATOR !== '1')(
	'evaluates scalar and String snapshots with the shipped javac and TeaVM, without a user program',
	async () => {
		const root = new URL('../../../static/teavm/', import.meta.url);
		const read = async (file: string) =>
			Uint8Array.from(
				await readFile(new URL(file, root)).catch(async () =>
					gunzipSync(await readFile(new URL(`${file}.gz`, root)))
				)
			);
		const loader = await import(new URL('compiler.wasm-runtime.js', root).href);
		const module = await loader.load(await read('compiler.wasm'), {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = module.exports.createCompiler();
		compiler.setSdk(new Int8Array(await read('compile-classlib-teavm.bin')));
		compiler.setTeaVMClasslib(new Int8Array(await read('runtime-classlib-teavm.bin')));
		const evaluate = (
			expression: string,
			bindings: Array<{ name: string; type: string; value: string | null }> = []
		) => evaluateSnapshot(compiler, loader.load, { expression, bindings });
		expect(
			await evaluate('number + 1', [{ name: 'number', type: 'int', value: '2147483647' }])
		).toBe('-2147483648');
		expect(
			await evaluate('wide + unit', [
				{ name: 'wide', type: 'long', value: '9007199254740993' },
				{ name: 'unit', type: 'char', value: '65' }
			])
		).toBe('9007199254741058');
		expect(await evaluate('number / 2', [{ name: 'number', type: 'int', value: '-7' }])).toBe(
			'-3'
		);
		expect(
			await evaluate('text.substring(1).equals("ello") && text.length() == 5', [
				{ name: 'text', type: 'String', value: 'hello' }
			])
		).toBe('true');
		const hostile = '"\n); System.exit(0); //\\u000a\u0000';
		expect(await evaluate('text', [{ name: 'text', type: 'String', value: hostile }])).toBe(
			JSON.stringify(hostile)
		);
		expect(await evaluate('text', [{ name: 'text', type: 'String', value: null }])).toBe(
			'null'
		);
		expect(await evaluate('unit', [{ name: 'unit', type: 'char', value: '10' }])).toBe('"\\n"');
		await expect(
			evaluate('number + true', [{ name: 'number', type: 'int', value: '7' }])
		).rejects.toThrow('Java expression compilation failed');
		expect(
			await evaluate('java.lang.Math.max(number, 9)', [
				{ name: 'number', type: 'int', value: '7' }
			])
		).toBe('9');
		for (const type of ['double', 'float']) {
			for (const value of ['-0.0', 'NaN', 'Infinity', '-Infinity']) {
				expect(
					await evaluate('number', [{ name: 'number', type, value }]),
					`${type} ${value}`
				).toBe(value);
			}
			expect(
				await evaluate('1.0 / number', [{ name: 'number', type, value: '-0.0' }]),
				`${type} negative-zero sign`
			).toBe('-Infinity');
		}
	},
	180_000
);
