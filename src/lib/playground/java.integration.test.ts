// @ts-nocheck
// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { prepareJavaStdinInjection } from './javaStdin';

const loadTeaVmArtifacts = async () => {
	const runtime = await import(
		new URL('../../../static/teavm/compiler.wasm-runtime.js', import.meta.url).href
	);
	const compilerWasm = new Uint8Array(
		await readFile(new URL('../../../static/teavm/compiler.wasm', import.meta.url))
	);
	const sdk = new Int8Array(
		await readFile(new URL('../../../static/teavm/compile-classlib-teavm.bin', import.meta.url))
	);
	const runtimeClasslib = new Int8Array(
		await readFile(new URL('../../../static/teavm/runtime-classlib-teavm.bin', import.meta.url))
	);

	return { runtime, compilerWasm, sdk, runtimeClasslib };
};

describe('TeaVM Java stdin integration', () => {
	it(
		'compiles and runs byte-oriented stdin code with injected snapshot input',
		async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const code = `public class Main {
    public static void main(String[] args) throws Exception {
        int sum = 0;
        int value = 0;
        boolean inNumber = false;
        int ch;

        while ((ch = System.in.read()) != -1) {
            if (ch >= '0' && ch <= '9') {
                value = value * 10 + (ch - '0');
                inNumber = true;
            } else if (inNumber) {
                sum += value;
                value = 0;
                inNumber = false;
            }
        }

        if (inNumber) {
            sum += value;
        }

        System.out.println("sum=" + sum);
    }
}`;
		const stdin = '1 2 3 4\n';
		const injection = prepareJavaStdinInjection(code, stdin);
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		const diagnostics: string[] = [];

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		compiler.addSourceFile('Main.java', injection.transformedCode);
		if (injection.helperSourcePath && injection.helperSource) {
			compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
		}

		expect(compiler.compile()).toBe(true);
		expect(Array.from(compiler.detectMainClasses())).toEqual(['Main']);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		(globalThis as typeof globalThis & {
			window?: { wasmIdleJavaStdin: { readByte: () => number } };
		}).window = {
			wasmIdleJavaStdin: {
				readByte: () => -1
			}
		};

		try {
			const module = await runtime.load(wasm, {
				installImports(imports: {
					teavmConsole: {
						putcharStdout: (code: number) => void;
						putcharStderr: (code: number) => void;
					};
				}) {
					imports.teavmConsole.putcharStdout = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
					imports.teavmConsole.putcharStderr = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
				},
				stackDeobfuscator: { enabled: false }
			});

			module.exports.main([]);
		} finally {
			delete (
				globalThis as typeof globalThis & {
					window?: { wasmIdleJavaStdin: { readByte: () => number } };
				}
			).window;
		}

			expect(outputs.join('')).toBe('sum=10\n');
		},
		10000
	);

	it(
		'reads live stdin chunks through the custom TeaVM bridge',
		async () => {
			const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
			const code = `public class Main {
    public static void main(String[] args) throws Exception {
        int first = System.in.read();
        int second = System.in.read();
        int third = System.in.read();
        System.out.println("" + (char) first + (char) second + (char) third);
    }
}`;
			const injection = prepareJavaStdinInjection(code, '');
			const compilerModule = await runtime.load(compilerWasm, {
				stackDeobfuscator: { enabled: false }
			});
			const compiler = compilerModule.exports.createCompiler();

			compiler.setSdk(sdk);
			compiler.setTeaVMClasslib(runtimeClasslib);
			compiler.addSourceFile('Main.java', injection.transformedCode);
			if (injection.helperSourcePath && injection.helperSource) {
				compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
			}

			expect(compiler.compile()).toBe(true);
			expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);

			const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
			const outputs: string[] = [];
			const bytes = ['A', 'B', 'C'].map((value) => value.charCodeAt(0));
			(globalThis as typeof globalThis & {
				window?: { wasmIdleJavaStdin: { readByte: () => number } };
			}).window = {
				wasmIdleJavaStdin: {
					readByte: () => bytes.shift() ?? -1
				}
			};

			try {
				const module = await runtime.load(wasm, {
					installImports(imports: {
						teavmConsole: {
							putcharStdout: (code: number) => void;
							putcharStderr: (code: number) => void;
						};
					}) {
						imports.teavmConsole.putcharStdout = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
						imports.teavmConsole.putcharStderr = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
					},
					stackDeobfuscator: { enabled: false }
				});

				module.exports.main([]);
			} finally {
				delete (
					globalThis as typeof globalThis & {
						window?: { wasmIdleJavaStdin: { readByte: () => number } };
					}
				).window;
			}

			expect(outputs.join('')).toBe('ABC\n');
		},
		10000
	);
});
