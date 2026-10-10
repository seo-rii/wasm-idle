// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadPyodide } from 'pyodide';
import { expect, it } from 'vitest';

it('validates cache regressions and JSON-RPC resolve with real Pyodide and pinned Jedi', async () => {
	const runtime = await loadPyodide();
	const root = new URL('../../', import.meta.url);
	const lock = JSON.parse(readFileSync(new URL('static/pyodide/pyodide-lock.json', root), 'utf8'));
	const site = runtime.runPython('import sysconfig\nsysconfig.get_paths()["purelib"]') as string;
	for (const name of ['parso', 'jedi']) {
		const entry = lock.packages[name];
		expect(entry.file_name).toMatch(/^[a-zA-Z0-9_.-]+\.whl$/);
		const bytes = readFileSync(new URL(`static/pyodide/${entry.file_name}`, root));
		expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
		runtime.unpackArchive(Uint8Array.from(bytes), 'whl', { extractDir: site });
	}
	for (const path of [
		'packages/lsp/src/python/package/wasm_idle_python_lsp/server.py',
		'packages/lsp/src/python/package/wasm_idle_python_lsp/__init__.py',
		'scripts/test-python-lsp-cache.py'
	]) {
		const target = `/work/${path}`;
		runtime.runPython(`import os\nos.makedirs(${JSON.stringify(target.slice(0, target.lastIndexOf('/')))}, exist_ok=True)`);
		runtime.FS.writeFile(target, readFileSync(new URL(path, root)));
	}
	const result = await runtime.runPythonAsync(`
import runpy, unittest, io
scope = runpy.run_path('/work/scripts/test-python-lsp-cache.py', run_name='cache_regressions')
suite = unittest.defaultTestLoader.loadTestsFromTestCase(scope['CacheTests'])
log = io.StringIO()
result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
assert result.wasSuccessful(), log.getvalue()
assert not result.skipped, log.getvalue()
assert result.testsRun == 13, log.getvalue()
result.testsRun
`);
	expect(result).toBe(13);
	// The regression script uses a Python emit fixture; exercise real JS/Python transport separately.
	runtime.runPython('import sys\n_ = sys.modules.pop("wasm_idle_lsp_bridge", None)');
	const messages: any[] = [];
	runtime.registerJsModule('wasm_idle_lsp_bridge', { emit: (payload: string) => messages.push(JSON.parse(payload)) });
	const bridge = runtime.runPython(`
sys.path.insert(0, '/work/packages/lsp/src/python/package')
from wasm_idle_python_lsp import create_bridge
create_bridge()
`);
	let sequence = 0;
	const request = (method: string, params: unknown = {}) => {
		const id = ++sequence;
		bridge(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
		const response = messages.find((message) => message.id === id);
		expect(response?.error).toBeUndefined();
		expect(response).toBeDefined();
		return response.result;
	};
	try {
		expect(request('initialize').capabilities.completionProvider.resolveProvider).toBe(true);
		const uri = 'file:///workspace/main.py';
		bridge(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
			textDocument: { uri, version: 1, languageId: 'python', text: 'import math\nmath.s' }
		} }));
		const list = request('textDocument/completion', { textDocument: { uri }, position: { line: 1, character: 6 } });
		const item = list.items.find((entry: any) => entry.label === 'sin');
		expect(item).toBeDefined();
		expect(item.documentation).toBeUndefined();
		expect(request('completionItem/resolve', item).documentation).toContain('sin');
		bridge(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {
			textDocument: { uri, version: 2 }, contentChanges: [{ text: 'changed = 1' }]
		} }));
		expect(request('completionItem/resolve', item)).toEqual(item);
		expect(request('shutdown')).toBeNull();
	} finally { bridge.destroy(); runtime.unregisterJsModule('wasm_idle_lsp_bridge'); }
}, 120_000);
