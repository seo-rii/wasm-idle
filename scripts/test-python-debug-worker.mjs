import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
function transpile(source) {
	const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
	assert.equal(result.diagnostics.length, 0);
	return result.outputText;
}
const preview = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonDebugPreview.ts', import.meta.url), 'utf8')), { exports: preview });
const stdio = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonStdio.ts', import.meta.url), 'utf8')), { exports: stdio, TextEncoder, TextDecoder, performance, setTimeout, clearTimeout });
const source = readFileSync(new URL('../src/lib/playground/worker/python.ts', import.meta.url), 'utf8');
const compiled = transpile(source + '\nexport function __inject(runtime: any) { pyodide = runtime; installPythonFlushHooks = () => Object.assign(() => {}, { destroy() {} }); }');
async function run(check) {
	const debugBuffer = new SharedArrayBuffer(64);
	const control = new Int32Array(debugBuffer);
	const messages = [];
	const self = { postMessage: (value) => messages.push(value) };
	const exports = {};
	vm.runInNewContext(compiled, {
		exports, self, postMessage: self.postMessage, TextEncoder, TextDecoder, URL, Blob, performance, setTimeout, clearTimeout,
		ArrayBuffer, SharedArrayBuffer, Int32Array, Uint8Array, Atomics,
		require(id) {
			if (id === './pythonDebugPreview') return preview;
			if (id === './pythonExecution') return { createPythonExecutionHelpers: () => ({ importSource: () => '' }) };
			if (id === './pythonStdio') return stdio;
			if (id.includes('sharedBuffer')) return { isSharedBufferBackedView: () => true };
			if (id.endsWith('/assets')) return { handleWorkerAssetMessage: () => false };
			return {};
		}
	});
	let calls = 0;
	exports.__inject({
		setStdin() {}, setStdout() {}, setStderr() {},
		FS: { mkdirTree() {}, writeFile() {} }, async loadPackagesFromImports() {}, setInterruptBuffer() {},
		async runPythonAsync(python) {
			calls++;
			execFileSync('python', ['-c', 'import ast,sys; compile(sys.stdin.read(), "<debug-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)'], { input: python });
			const name = Object.keys(self).find((name) => name.startsWith('__wasm_idle_python_debug_breakpoints_'));
			check(self[name], control);
		}
	});
	await self.onmessage({ data: { code: 'x = 1', debug: true, debugBuffer,
		buffer: new SharedArrayBuffer(64), watchBuffer: new SharedArrayBuffer(64),
		watchResultBuffer: new SharedArrayBuffer(64), interrupt: new SharedArrayBuffer(4) } });
	assert.equal(calls, 1);
	assert.equal(messages.at(-1).results, true);
}
test('unchanged breakpoint version returns null before touching the payload', () => run((read, view) => {
	Atomics.store(view, 2, 7);
	Atomics.store(view, 3, 2);
	Atomics.store(view, 4, 3);
	Atomics.store(view, 5, 9);
	for (let i = 0; i < 1000; i++) assert.equal(read(7), null);
	assert.deepEqual(JSON.parse(read(6)), { version: 7, lines: [3, 9] });
}));
test('changed breakpoint payload retains bounds and filters nonpositive lines', () => run((read, view) => {
	Atomics.store(view, 2, 1);
	Atomics.store(view, 3, 1000000);
	Atomics.store(view, 4, -5);
	Atomics.store(view, 5, 11);
	assert.deepEqual(JSON.parse(read(0)), { version: 1, lines: [11] });
}));
