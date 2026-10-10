// @vitest-environment node
// Requires the pinned real TeaVM assets; this test must not substitute a mock compiler.
import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createJavaStdinBridge, prepareJavaRuntimeStdinInjection } from './javaRuntimeStdin';

const gunzipAsync = promisify(gunzip);
async function readAsset(name: string) {
	const plain = await readFile(new URL(`../../../static/teavm/${name}`, import.meta.url)).catch(
		() => null
	);
	return (
		plain ??
		(await gunzipAsync(
			await readFile(new URL(`../../../static/teavm/${name}.gz`, import.meta.url))
		))
	);
}

it('executes one TeaVM artifact with fresh empty, Unicode, large, interactive and legacy input', async () => {
	const runtime = await import(
		new URL('../../../static/teavm/compiler.wasm-runtime.js', import.meta.url).href
	);
	const compilerModule = await runtime.load(new Uint8Array(await readAsset('compiler.wasm')), {
		stackDeobfuscator: { enabled: false }
	});
	const compiler = compilerModule.exports.createCompiler();
	compiler.setSdk(new Int8Array(await readAsset('compile-classlib-teavm.bin')));
	compiler.setTeaVMClasslib(new Int8Array(await readAsset('runtime-classlib-teavm.bin')));
	const source = `import java.io.InputStream;
public class Main {
    public static void main(String[] args) throws Exception {
        InputStream input = System.in;
        byte[] buffer = new byte[31];
        if (input.read(buffer, 2, 0) != 0) throw new AssertionError("zero read");
        int count = 0, sum = 0, length;
        while ((length = input.read(buffer, 2, 27)) != -1) {
            for (int i = 2; i < 2 + length; i++) sum += buffer[i] & 255;
            count += length;
        }
        if (input.read() != -1) throw new AssertionError("EOF must be sticky");
        System.out.println(count + ":" + sum);
    }
}`;
	const injection = prepareJavaRuntimeStdinInjection(source);
	const diagnostics: string[] = [];
	compiler.onDiagnostic((diagnostic: { message?: string }) =>
		diagnostics.push(String(diagnostic.message ?? ''))
	);
	compiler.addSourceFile('Main.java', injection.transformedCode);
	compiler.addSourceFile('WasmIdleStdin.java', injection.helperSource!);
	expect(compiler.compile(), diagnostics.join('\n')).toBe(true);
	expect(
		compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' }),
		diagnostics.join('\n')
	).toBe(true);
	const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
	const originalBytes = wasm.slice();
	const globals = globalThis as unknown as Record<string, unknown>;
	const hadBridge = Object.prototype.hasOwnProperty.call(globals, 'wasmIdleJavaStdin');
	const previous = globals.wasmIdleJavaStdin;
	const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window');
	const previousWindow = globals.window;
	globals.window = globalThis;
	try {
		for (const sample of [
			{ text: '', mode: 'explicit' },
			{ text: '한글🙂é\n', mode: 'explicit' },
			{ text: '1234567890\n'.repeat(10000), mode: 'explicit' },
			{ text: 'first\nsecond 한글\n', mode: 'interactive' },
			{ text: 'fallback é\n', mode: 'legacy' }
		]) {
			const { text, mode } = sample;
			const pending = ['', 'second 한글\n', null];
			const bridge = createJavaStdinBridge(
				mode === 'interactive' ? 'first\n' : text,
				mode !== 'interactive',
				() => {
					if (mode !== 'interactive') throw new Error('explicit input must not block');
					return pending.shift() ?? null;
				}
			);
			let blockCalls = 0;
			globals.wasmIdleJavaStdin =
				mode === 'legacy'
					? { readByte: bridge.readByte }
					: {
							readChunk: () => {
								blockCalls++;
								return bridge.readChunk();
							},
							readByte: () => {
								throw new Error(
									'chunk-capable input must not use the byte fallback'
								);
							}
						};
			const output: string[] = [];
			try {
				const module = await runtime.load(wasm, {
					installImports(imports: {
						teavmConsole: {
							putcharStdout: (code: number) => void;
							putcharStderr: (code: number) => void;
						};
					}) {
						imports.teavmConsole.putcharStdout = (code) =>
							output.push(String.fromCharCode(code));
						imports.teavmConsole.putcharStderr = (code) =>
							output.push(String.fromCharCode(code));
					},
					stackDeobfuscator: { enabled: false }
				});
				try {
					module.exports.main([]);
				} catch (error) {
					throw new Error(`TeaVM ${mode} input (${text.length} chars) failed`, {
						cause: error
					});
				}
				const bytes = new TextEncoder().encode(text);
				expect(output.join('')).toBe(
					`${bytes.length}:${bytes.reduce((sum, byte) => sum + byte, 0)}\n`
				);
				expect(wasm).toEqual(originalBytes);
				if (mode === 'explicit')
					expect(blockCalls).toBe(Math.ceil(bytes.length / 4096) + 1);
				if (mode === 'interactive') expect(pending).toEqual([]);
			} finally {
				bridge.dispose();
			}
		}
	} finally {
		if (hadWindow) globals.window = previousWindow;
		else delete globals.window;
		if (hadBridge) globals.wasmIdleJavaStdin = previous;
		else delete globals.wasmIdleJavaStdin;
	}
}, 120_000);
