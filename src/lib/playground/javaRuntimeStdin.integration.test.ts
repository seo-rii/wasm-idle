// @vitest-environment node
// Requires the pinned real TeaVM assets; this test must not substitute a mock compiler.
import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createJavaStdinBridge, prepareJavaRuntimeStdinInjection } from './javaRuntimeStdin';

const gunzipAsync = promisify(gunzip);
async function readAsset(name: string) {
	const plain = await readFile(new URL(`../../../static/teavm/${name}`, import.meta.url)).catch(() => null);
	return plain ?? await gunzipAsync(await readFile(new URL(`../../../static/teavm/${name}.gz`, import.meta.url)));
}

it('executes one TeaVM artifact with fresh empty, Unicode and large byte input', async () => {
	const runtime = await import(new URL('../../../static/teavm/compiler.wasm-runtime.js', import.meta.url).href);
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
	compiler.onDiagnostic((diagnostic: { message?: string }) => diagnostics.push(String(diagnostic.message ?? '')));
	compiler.addSourceFile('Main.java', injection.transformedCode);
	compiler.addSourceFile('WasmIdleStdin.java', injection.helperSource!);
	expect(compiler.compile(), diagnostics.join('\n')).toBe(true);
	expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' }), diagnostics.join('\n')).toBe(true);
	const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
	const originalBytes = wasm.slice();
	const globals = globalThis as typeof globalThis & { wasmIdleJavaStdin?: unknown };
	const hadBridge = Object.prototype.hasOwnProperty.call(globals, 'wasmIdleJavaStdin');
	const previous = globals.wasmIdleJavaStdin;
	try {
		for (const text of ['', '한글🙂é\n', '1234567890\n'.repeat(10000)]) {
			const bridge = createJavaStdinBridge(text, true, () => { throw new Error('explicit input must not block'); });
			globals.wasmIdleJavaStdin = bridge;
			const output: string[] = [];
			try {
				const module = await runtime.load(wasm, {
					installImports(imports: { teavmConsole: { putcharStdout: (code: number) => void; putcharStderr: (code: number) => void } }) {
						imports.teavmConsole.putcharStdout = (code) => output.push(String.fromCharCode(code));
						imports.teavmConsole.putcharStderr = (code) => output.push(String.fromCharCode(code));
					},
					stackDeobfuscator: { enabled: false }
				});
				module.exports.main([]);
				const bytes = new TextEncoder().encode(text);
				expect(output.join('')).toBe(`${bytes.length}:${bytes.reduce((sum, byte) => sum + byte, 0)}\n`);
				expect(wasm).toEqual(originalBytes);
			} finally { bridge.dispose(); }
		}
	} finally {
		if (hadBridge) globals.wasmIdleJavaStdin = previous;
		else delete globals.wasmIdleJavaStdin;
	}
}, 120_000);
