import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const importsExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonWorkspaceImports.ts', import.meta.url), 'utf8')), { exports: importsExports });
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

const stdioExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonStdio.ts', import.meta.url), 'utf8')), { exports: stdioExports, TextEncoder, TextDecoder, performance, setTimeout, clearTimeout });
const previewExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonDebugPreview.ts', import.meta.url), 'utf8')), { exports: previewExports });
const workspaceExports = {};
vm.runInNewContext(transpile(readFileSync(new URL('../src/lib/playground/worker/pythonWorkspaceFiles.ts', import.meta.url), 'utf8')), { exports: workspaceExports });
const workerCode = transpile(readFileSync(new URL('../src/lib/playground/worker/python.ts', import.meta.url), 'utf8') + '\nexport function __inject(runtime: any) { pyodide = runtime; installedHyVersion = "test"; installPythonFlushHooks = () => Object.assign(() => {}, { destroy() {} }); }');
function workerFixture() {
	const messages = [], scanned = [], packageLoads = [], cachedRuns = [], legacyRuns = [], writes = [], invalidated = [];
	const filesystemNodes = new Map();
	const absolutePath = (path) => path.startsWith('/') ? path : `/home/pyodide/${path}`;
	const fs = {
		mkdirTree(path) { filesystemNodes.set(absolutePath(path), { mode: 0o040755 }); },
		writeFile(...args) {
			writes.push(args);
			filesystemNodes.set(absolutePath(args[0]), { mode: 0o100644 });
		},
		cwd: () => '/home/pyodide',
		analyzePath: (path) => ({ exists: filesystemNodes.has(absolutePath(path)) }),
		lstat: (path) => filesystemNodes.get(absolutePath(path)),
		isDir: (mode) => (mode & 0o170000) === 0o040000,
		unlink(path) {
			if (fs.isDir(fs.lstat(path).mode)) throw new Error('cannot unlink a directory');
			filesystemNodes.delete(absolutePath(path));
		}
	};
	let initialized = 0;
	const self = { postMessage: (value) => messages.push(value) };
	const exports = {};
	vm.runInNewContext(workerCode, {
		exports, self, postMessage: self.postMessage, TextEncoder, TextDecoder, URL, Blob, performance, setTimeout, clearTimeout,
		ArrayBuffer, SharedArrayBuffer, Int32Array, Uint8Array, Atomics,
		require(id) {
			if (id === './pythonStdio') return stdioExports;
			if (id === './pythonDebugPreview') return previewExports;
			if (id === './pythonWorkspaceFiles') return workspaceExports;
			if (id === './pythonExecution') return { createPythonExecutionHelpers() {
				initialized++;
				return { importSource(source) { scanned.push(source); return source.includes('numpy') ? 'import numpy' : ''; },
					async run(code, filename, ready) { cachedRuns.push({ code, filename }); ready(); } };
			} };
			if (id === './pythonWorkspaceImports') return importsExports;
			if (id.includes('sharedBuffer')) return { isSharedBufferBackedView: () => true };
			if (id.endsWith('/assets')) return { handleWorkerAssetMessage: () => false };
			return {};
		}
	});
	exports.__inject({ FS: fs,
		setStdin() {}, setStdout() {}, setStderr() {},
		runPython(source) {
			assert.equal(source, importsExports.PYTHON_WORKSPACE_IMPORTS_FACTORY);
			return Object.assign(() => (paths) => invalidated.push(JSON.parse(paths)), { destroy() {} });
		},
		async loadPackagesFromImports(source) { packageLoads.push(source); }, setInterruptBuffer() {},
		async runPythonAsync(source) {
			legacyRuns.push(source);
			execFileSync(process.env.PYTHON ?? 'python3', ['-c', 'import ast,sys; compile(sys.stdin.read(), "<legacy-wrapper>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)'], { input: source });
		} });
	const send = (data) => self.onmessage({ data: { buffer: new SharedArrayBuffer(64), debugBuffer: new SharedArrayBuffer(64),
		watchBuffer: new SharedArrayBuffer(64), watchResultBuffer: new SharedArrayBuffer(64), interrupt: new SharedArrayBuffer(4), ...data } });
	return { send, self, messages, scanned, packageLoads, cachedRuns, legacyRuns, writes, invalidated, filesystemNodes, initialized: () => initialized };
}
test('worker preparation and execution preserve generated directories replacing supplied inputs', async () => {
	const f = workerFixture();
	await f.send({ code: 'pass', workspaceFiles: [{ path: 'input', content: 'input data' }] });
	f.filesystemNodes.set('/home/pyodide/input', { mode: 0o040755 });
	f.filesystemNodes.set('/home/pyodide/input/output.txt', { mode: 0o100644 });
	await f.send({ code: 'pass', workspaceFiles: [], prepare: true });
	assert.equal(f.messages.at(-1).results, true);
	assert.ok(f.filesystemNodes.has('/home/pyodide/input/output.txt'));
	await f.send({ code: 'pass', workspaceFiles: [] });
	assert.equal(f.messages.at(-1).results, true);

	// Once ownership is released, later generated files at that path survive.
	f.filesystemNodes.set('/home/pyodide/input', { mode: 0o100644 });
	await f.send({ code: 'pass', workspaceFiles: [], prepare: true });
	assert.equal(f.messages.at(-1).results, true);
	assert.ok(f.filesystemNodes.has('/home/pyodide/input'));
});
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
	assert.deepEqual(f.invalidated, [['bad.py', 'data.csv'], ['bad.py', 'data.csv'], ['bad.py', 'data.csv']]);
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
test('the actual debug wrapper gives user code its active filename', async () => {
	const f = workerFixture();
	await f.send({ code: 'assert __file__ == "subdir/main.py"\nprint(__file__)', activePath: 'subdir/main.py', debug: true });
	assert.equal(f.messages.at(-1).results, true);
	const output = execFileSync(process.env.PYTHON ?? 'python3', ['-c', `import ast, asyncio, sys, types
bridge = types.ModuleType("js")
bridge.__getattr__ = lambda name: types.SimpleNamespace(version=0) if name.startswith("__wasm_idle_python_debug_breakpoint_state_") else lambda *args: None
sys.modules["js"] = bridge
asyncio.run(eval(compile(sys.stdin.read(), "<debug-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)))
`], { input: f.legacyRuns[0], encoding: 'utf8' });
	assert.equal(output, 'subdir/main.py\n');
});
test('the actual debug wrapper connects user classes and globals to __main__ and restores it', async () => {
	const f = workerFixture();
	await f.send({ code: `import __main__, pickle
value = 7
class Record:
    pass
record = Record()
assert __main__.__dict__ is globals()
assert isinstance(pickle.loads(pickle.dumps(record)), Record)
print(__main__.value)`, activePath: 'main.py', debug: true });
	assert.equal(f.messages.at(-1).results, true);
	const output = execFileSync(process.env.PYTHON ?? 'python3', ['-c', `import ast, asyncio, sys, types
bridge = types.ModuleType("js")
bridge.__getattr__ = lambda name: types.SimpleNamespace(version=0) if name.startswith("__wasm_idle_python_debug_breakpoint_state_") else lambda *args: None
sys.modules["js"] = bridge
original_main = sys.modules["__main__"]
asyncio.run(eval(compile(sys.stdin.read(), "<debug-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)))
assert sys.modules["__main__"] is original_main
`], { input: f.legacyRuns[0], encoding: 'utf8' });
	assert.equal(output, '7\n');
	await f.send({ code: 'raise ValueError("user failure")', activePath: 'failure.py', debug: true });
	execFileSync(process.env.PYTHON ?? 'python3', ['-c', `import ast, asyncio, sys, types
bridge = types.ModuleType("js")
bridge.__getattr__ = lambda name: types.SimpleNamespace(version=0) if name.startswith("__wasm_idle_python_debug_breakpoint_state_") else lambda *args: None
sys.modules["js"] = bridge
original_main = sys.modules["__main__"]
original_path = sys.path
try:
    asyncio.run(eval(compile(sys.stdin.read(), "<debug-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)))
except ValueError as error:
    assert str(error) == "user failure"
else:
    raise AssertionError("Expected user failure")
assert sys.modules["__main__"] is original_main
assert sys.path is original_path
`], { input: f.legacyRuns.at(-1) });
});
test('the actual debug wrapper searches sibling and root modules and restores sys.path', async () => {
	const f = workerFixture();
	await f.send({ code: 'import wid24_helper, wid24_shared\nprint(wid24_helper.VALUE, wid24_shared.VALUE)', activePath: 'subdir/main.py', debug: true });
	assert.equal(f.messages.at(-1).results, true);
	const output = execFileSync(process.env.PYTHON ?? 'python3', ['-c', `import ast, asyncio, os, sys, types, tempfile
from pathlib import Path
bridge = types.ModuleType("js")
bridge.__getattr__ = lambda name: types.SimpleNamespace(version=0) if name.startswith("__wasm_idle_python_debug_breakpoint_state_") else lambda *args: None
sys.modules["js"] = bridge
original_cwd, original_path = os.getcwd(), sys.path
original_entries = list(original_path)
with tempfile.TemporaryDirectory() as root:
    root = Path(root)
    (root / "subdir").mkdir()
    (root / "wid24_helper.py").write_text("VALUE = 100")
    (root / "subdir/wid24_helper.py").write_text("VALUE = 7")
    (root / "wid24_shared.py").write_text("VALUE = 9")
    try:
        os.chdir(root)
        asyncio.run(eval(compile(sys.stdin.read(), "<debug-worker>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)))
    finally:
        os.chdir(original_cwd)
assert sys.path is original_path
assert sys.path == original_entries
`], { input: f.legacyRuns[0], encoding: 'utf8' });
	assert.equal(output, '7 9\n');
});
test('Hy retains its genuine compiler wrapper and bypasses the Python source cache', async () => {
	const f = workerFixture();
	await f.send({ code: '(print 42)', language: 'hy' });
	assert.equal(f.initialized(), 0);
	assert.equal(f.legacyRuns.length, 1);
	assert.match(f.legacyRuns[0], /hy.compiler.hy_compile/);
	assert.equal(f.messages.at(-1).results, true);
});
