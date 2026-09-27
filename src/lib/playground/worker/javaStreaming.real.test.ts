import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { TEAVM_RUNTIME_ASSET_RECEIPTS } from '@wasm-idle/core';
import { compileVerifiedWasmResponse, acceptCompiledTeaVmModule } from './javaStreaming';

it.skipIf(process.env.WASM_IDLE_RUN_REAL_JAVA_STREAMING !== '1')('compiles and runs Java through the streaming compiler module', async () => {
	const root = new URL('../../../../static/teavm/', import.meta.url);
	const source = await readFile(new URL('compiler.wasm-runtime.js', root), 'utf8');
	const loader = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(acceptCompiledTeaVmModule(source)).toString('base64'));
	const wasm = Uint8Array.from(gunzipSync(await readFile(new URL('compiler.wasm.gz', root))));
	const module = await compileVerifiedWasmResponse(new Response(wasm), TEAVM_RUNTIME_ASSET_RECEIPTS['compiler.wasm'], 10 * 1024 * 1024);
	const runtime = await loader.load(module, { stackDeobfuscator: { enabled: false } });
	const compiler = runtime.exports.createCompiler();
	compiler.setSdk(Int8Array.from(await readFile(new URL('compile-classlib-teavm.bin', root))));
	compiler.setTeaVMClasslib(Int8Array.from(gunzipSync(await readFile(new URL('runtime-classlib-teavm.bin.gz', root)))));
	compiler.addSourceFile('Main.java', 'public class Main { public static void main(String[] args) { System.out.println("stream-probe-" + (40+2)); } }');
	expect(compiler.compile()).toBe(true);
	expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);
	let stdout = '', stderr = '';
	const app = await loader.load(new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm')), {
		stackDeobfuscator: { enabled: false },
		installImports(imports: any) {
			imports.teavmConsole.putcharStdout = (c: number) => { stdout += String.fromCharCode(c); };
			imports.teavmConsole.putcharStderr = (c: number) => { stderr += String.fromCharCode(c); };
		}
	});
	await app.exports.main([]);
	expect(stdout).toBe('stream-probe-42\n'); expect(stderr).toBe('');
}, 120_000);
