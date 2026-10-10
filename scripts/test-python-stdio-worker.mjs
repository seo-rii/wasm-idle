import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const workerPath = new URL('../src/lib/playground/worker/python.ts', import.meta.url);
function transpile(source) {
	const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
	assert.equal(result.diagnostics.length, 0);
	return result.outputText;
}
const stdioExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonStdio.ts', import.meta.url), 'utf8')), { exports: stdioExports, TextEncoder, TextDecoder, performance, setTimeout, clearTimeout });
const code = transpile(readFileSync(workerPath, 'utf8') + '\nexport function __inject(runtime: any, installer: any) { pyodide = runtime; installPythonFlushHooks = installer; installedHyVersion = "test"; }');

async function execute({ debug = false, language = 'python', fail = false, hookFailure = false } = {}) {
	const messages = [], sources = [], events = [];
	let out;
	const runtime = {
		FS: { mkdirTree() {}, writeFile() {} },
		async loadPackagesFromImports() {},
		setInterruptBuffer() {}, setStdin() {}, setStdout(value) { out = value; }, setStderr() {},
		async runPythonAsync(source) {
			sources.push(source);
			out.write(new TextEncoder().encode('pending'));
			if (fail) throw new Error('execution failure');
		}
	};
	const self = { postMessage(message) { messages.push(message); events.push(message.results ? 'results' : message.error ? 'error' : 'output'); } };
	const exports = {};
	vm.runInNewContext(code, {
		exports, self, postMessage: self.postMessage, performance, setTimeout, clearTimeout,
		TextEncoder, TextDecoder, URL, Blob, ArrayBuffer, SharedArrayBuffer, Int32Array, Uint8Array, Atomics,
		require(id) {
			if (id === './pythonStdio') return stdioExports;
			if (id === './pythonExecution') return { createPythonExecutionHelpers: () => ({
				importSource: () => '',
				async run(source, _filename, ready) { ready(); await runtime.runPythonAsync(source); }
			}) };
			if (id === './pythonDebugPreview') return { PYTHON_DEBUG_PREVIEW: 'def __wasm_idle_debug_preview(value):\n    return "preview"' };
			if (id.includes('stdinBuffer')) return { waitForBufferedStdin: () => null };
			if (id.includes('sharedBuffer')) return { isSharedBufferBackedView: () => true };
			if (id.endsWith('/assets')) return { handleWorkerAssetMessage: () => false };
			return {};
		}
	});
	exports.__inject(runtime, () => {
		if (hookFailure) throw new Error('non-mutable stream');
		const restore = () => events.push('restore');
		restore.destroy = () => events.push('destroy');
		return restore;
	});
	await self.onmessage({ data: {
		code: language === 'hy' ? '(print 42)' : 'print(42)', debug, language,
		buffer: new SharedArrayBuffer(1024), debugBuffer: new SharedArrayBuffer(1024),
		watchBuffer: new SharedArrayBuffer(1024), watchResultBuffer: new SharedArrayBuffer(1024),
		interrupt: new SharedArrayBuffer(4)
	} });
	for (const source of sources) {
		execFileSync('python', ['-c', 'import ast,sys; compile(sys.stdin.read(), "<expanded-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)'], { input: source });
		assert.ok(!source.includes('builtins.print = __wasm_idle_output'));
	}
	assert.equal(messages.filter((m) => m.output).map((m) => m.output).join(''), 'pending');
	assert.ok(events.indexOf('output') < events.indexOf(fail ? 'error' : 'results'));
	assert.equal(self.prompt, undefined);
	return { messages, events, sources };
}

test('normal worker uses native stdio and drains before results', async () => {
	const r = await execute();
	assert.equal(r.sources.length, 1);
	assert.ok(r.events.indexOf('restore') < r.events.indexOf('results'));
});
test('debug wrapper is valid Python and flushes before pausing', async () => {
	const r = await execute({ debug: true });
	assert.match(r.sources[0], /sys.stdout.flush\(\)\n    sys.stderr.flush\(\)\n    __wasm_idle_python_debug_pause_/);
});
test('Hy wrapper remains valid Python and follows the same stream lifecycle', () => execute({ language: 'hy' }));
test('execution errors drain output and dispose hooks before error notification', async () => {
	const r = await execute({ fail: true });
	assert.equal(r.messages.at(-1).error, 'execution failure');
	assert.ok(r.events.indexOf('destroy') < r.events.indexOf('error'));
});
test('unsupported mutable-stream hooks fall back to unbatched native I/O', () => execute({ hookFailure: true }));
