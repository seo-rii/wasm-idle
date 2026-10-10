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
const helperExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonExecution.ts', import.meta.url), 'utf8')), { exports: helperExports });
function helperFixture({ failRun = false, failNamespace = false } = {}) {
	const destroyed = [], namespaces = [], evaluations = [];
	const proxy = (fn, name) => Object.assign(fn, { destroy: () => destroyed.push(name) });
	const run = proxy(() => {}, 'run');
	const scan = proxy((source) => `import ${source}`, 'imports');
	const makeNamespace = proxy(() => {
		const map = new Map();
		map.destroy = () => destroyed.push(map);
		namespaces.push(map);
		return map;
	}, 'dict');
	const helpers = { get: (key) => key === 'run' ? run : scan, destroy: () => destroyed.push('helpers') };
	const factory = proxy(() => helpers, 'factory');
	const runtime = {
		runPython(source) {
			if (source === 'dict') { if (failNamespace) throw new Error('dict failure'); return makeNamespace; }
			assert.equal(source, helperExports.PYTHON_EXECUTION_FACTORY);
			return factory;
		},
		async runPythonAsync(source, options) {
			evaluations.push({ source, globals: options.globals });
			if (failRun) throw new Error('run failure');
		}
	};
	return { runtime, destroyed, namespaces, evaluations, create: () => helperExports.createPythonExecutionHelpers(runtime, 'image hook') };
}
test('run data uses a fresh Python dictionary, not Python string interpolation', async () => {
	const f = helperFixture();
	const helpers = f.create();
	const source = 'print("한글\\n")\n# arbitrary quotes: \'"';
	for (let i = 0; i < 2; i++) await helpers.run(source, 'main.py', () => {}, () => null, () => {});
	assert.equal(f.namespaces.length, 2);
	assert.notEqual(f.namespaces[0], f.namespaces[1]);
	for (const call of f.evaluations) {
		assert.equal(call.source, 'await runner(source, filename, ready, input_bridge, output_bridge)');
		assert.equal(call.globals.get('source'), source);
		assert.ok(f.destroyed.includes(call.globals));
	}
});
test('run exceptions still destroy the temporary namespace', async () => {
	const f = helperFixture({ failRun: true });
	await assert.rejects(f.create().run('', 'main.py', () => {}, () => null, () => {}), /run failure/);
	assert.ok(f.destroyed.includes(f.namespaces[0]));
});
test('dispose releases retained function proxies once and rejects later calls', () => {
	const f = helperFixture();
	const helpers = f.create();
	assert.equal(helpers.importSource('numpy'), 'import numpy');
	helpers.dispose(); helpers.dispose();
	for (const name of ['factory', 'helpers', 'run', 'imports', 'dict']) assert.equal(f.destroyed.filter((value) => value === name).length, 1);
	assert.throws(() => helpers.importSource('numpy'), /disposed/);
});
test('partial helper initialization cleans up acquired proxies', () => {
	const f = helperFixture({ failNamespace: true });
	assert.throws(f.create, /dict failure/);
	for (const name of ['factory', 'helpers', 'run', 'imports']) assert.ok(f.destroyed.includes(name));
});

const workerCode = transpile(readFileSync(new URL('../src/lib/playground/worker/python.ts', import.meta.url), 'utf8') + '\nexport function __inject(runtime: any) { pyodide = runtime; installedHyVersion = "test"; }');
function workerFixture() {
	const messages = [], scanned = [], packageLoads = [], cachedRuns = [], legacyRuns = [], writes = [];
	let initialized = 0;
	const self = { postMessage: (value) => messages.push(value) };
	const exports = {};
	vm.runInNewContext(workerCode, {
		exports, self, postMessage: self.postMessage, TextEncoder, TextDecoder, URL, Blob,
		ArrayBuffer, SharedArrayBuffer, Int32Array, Uint8Array, Atomics,
		require(id) {
			if (id === './pythonExecution') return { createPythonExecutionHelpers() {
				initialized++;
				return { importSource(source) { scanned.push(source); return source.includes('numpy') ? 'import numpy' : ''; },
					async run(code, filename, ready) { cachedRuns.push({ code, filename }); ready(); } };
			} };
			if (id.includes('sharedBuffer')) return { isSharedBufferBackedView: () => true };
			if (id.endsWith('/assets')) return { handleWorkerAssetMessage: () => false };
			return {};
		}
	});
	exports.__inject({ FS: { mkdirTree() {}, writeFile(...args) { writes.push(args); } },
		async loadPackagesFromImports(source) { packageLoads.push(source); }, setInterruptBuffer() {},
		async runPythonAsync(source) {
			legacyRuns.push(source);
			execFileSync('python', ['-c', 'import ast,sys; compile(sys.stdin.read(), "<legacy-wrapper>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)'], { input: source });
		} });
	const send = (data) => self.onmessage({ data: { buffer: new SharedArrayBuffer(64), debugBuffer: new SharedArrayBuffer(64),
		watchBuffer: new SharedArrayBuffer(64), watchResultBuffer: new SharedArrayBuffer(64), interrupt: new SharedArrayBuffer(4), ...data } });
	return { send, self, messages, scanned, packageLoads, cachedRuns, legacyRuns, writes, initialized: () => initialized };
}
test('files are analyzed separately and package state is checked again after an execution', async () => {
	const f = workerFixture();
	const data = { code: 'import numpy', activePath: 'main.py', workspaceFiles: [{ path: 'bad.py', content: 'def :' }, { path: 'data.csv', content: '1,2,3' }] };
	await f.send({ ...data, prepare: true });
	await f.send(data); // only this matching run consumes the preparation token
	await f.send(data);
	assert.deepEqual(f.packageLoads, ['import numpy', 'import numpy']);
	assert.deepEqual(f.scanned, ['import numpy', 'def :', '1,2,3', 'import numpy', 'def :', '1,2,3']);
	assert.equal(f.initialized(), 1);
	assert.equal(f.cachedRuns.length, 2);
	assert.equal(f.legacyRuns.length, 0);
	assert.equal(f.writes.length, 6); // no unsafe cross-run file-state caching
	assert.equal(f.self.prompt, undefined);
	assert.ok(!Object.keys(f.self).some((name) => name.startsWith('__pyodide__')));
});
test('debug execution retains the legacy trace wrapper', async () => {
	const f = workerFixture();
	await f.send({ code: 'print(42)', debug: true });
	assert.equal(f.cachedRuns.length, 0);
	assert.equal(f.legacyRuns.length, 1);
	assert.match(f.legacyRuns[0], /sys.settrace\(__wasm_idle_debug_trace\)/);
	assert.equal(f.messages.at(-1).results, true);
});
test('Hy retains its genuine compiler wrapper and bypasses the Python source cache', async () => {
	const f = workerFixture();
	await f.send({ code: '(print 42)', language: 'hy' });
	assert.equal(f.initialized(), 0);
	assert.equal(f.legacyRuns.length, 1);
	assert.match(f.legacyRuns[0], /hy.compiler.hy_compile/);
	assert.equal(f.messages.at(-1).results, true);
});
