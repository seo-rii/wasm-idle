import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<any>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: any[] = [];
		terminated = false;

		constructor() {
			workers.push(this);
		}

		addEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].add(handler);
		}

		removeEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].delete(handler);
		}

		postMessage(message: any) {
			this.messages.push(message);
			if (message.type !== 'init') return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'progress', stage: 'load-pyodide' } } as MessageEvent<any>);
			}
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready' } } as MessageEvent<any>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}

	class MockReader {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	class MockWriter {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	return { workers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { getPythonLanguageServer } from '../src/index.js';

describe('getPythonLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the Pyodide-backed Python LSP worker', async () => {
		const status = vi.fn();
		const handle = await getPythonLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			persistentAssets: expect.objectContaining({
				persistentCache: expect.objectContaining({ enabled: true })
			}),
			pyodideBaseUrl: 'https://static.example.com/repl_20240807/pyodide/'
		});
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'startup',
			loaded: 0,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-pyodide',
			loaded: 0.35,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});

	it('does not create a worker when startup is already cancelled', async () => {
		const controller = new AbortController();
		controller.abort(new Error('Python LSP startup cancelled'));

		await expect(
			getPythonLanguageServer({
				rootUrl: 'https://static.example.com/repl_20240807',
				signal: controller.signal,
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('Python LSP startup cancelled');
		expect(mockState.workers).toHaveLength(0);
	});

	it('does not infer stock receipts for an explicitly customized Python runtime', async () => {
		const handle = await getPythonLanguageServer({
			rootUrl: 'https://static.example.com/repl',
			python: { baseUrl: 'https://static.example.com/repl/custom-python' },
			persistentCache: false,
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			pyodideBaseUrl: 'https://static.example.com/repl/custom-python/',
			persistentAssets: { assetRoot: undefined, persistentCache: { enabled: false } }
		});
		handle.dispose();
	});
});

const uriCases = [
	{
		name: 'preserves the requesting file URI for document symbols',
		method: 'textDocument/documentSymbol',
		requestUri: 'file:///workspace/main.py',
		modulePath: '/workspace/main.py',
		expectedUri: 'file:///workspace/main.py'
	},
	{
		name: 'preserves the requesting encoded file URI for document symbols',
		method: 'textDocument/documentSymbol',
		requestUri: 'file:///workspace/my%20file.py',
		modulePath: '/workspace/my file.py',
		expectedUri: 'file:///workspace/my%20file.py'
	},
	{
		name: 'preserves the requesting decoded file URI used by Monaco',
		method: 'textDocument/documentSymbol',
		requestUri: 'file:///workspace/my file.py',
		modulePath: '/workspace/my file.py',
		expectedUri: 'file:///workspace/my file.py'
	},
	{
		name: 'preserves legacy bare-path document symbol requests',
		method: 'textDocument/documentSymbol',
		requestUri: '/workspace/main.py',
		modulePath: '/workspace/main.py',
		expectedUri: '/workspace/main.py'
	},
	{
		name: 'preserves the requesting URI when Jedi has no module path',
		method: 'textDocument/documentSymbol',
		requestUri: 'file:///workspace/main.py',
		modulePath: null,
		expectedUri: 'file:///workspace/main.py'
	},
	{
		name: 'preserves the requesting file URI for same-document definitions',
		method: 'textDocument/definition',
		requestUri: 'file:///workspace/main.py',
		modulePath: '/workspace/main.py',
		expectedUri: 'file:///workspace/main.py'
	},
	{
		name: 'normalizes another document to an encoded file URI',
		method: 'textDocument/definition',
		requestUri: 'file:///workspace/main.py',
		modulePath: '/workspace/helper #1.py',
		expectedUri: 'file:///workspace/helper%20%231.py'
	},
	{
		name: 'preserves bare-path locations for legacy requests into another document',
		method: 'textDocument/definition',
		requestUri: '/workspace/main.py',
		modulePath: '/workspace/helper.py',
		expectedUri: '/workspace/helper.py'
	}
] as const;

// Run the shipped Python server and JSON-RPC handlers. Only Jedi's name results
// are fixed, so URI behavior does not depend on downloading semantic packages.
const pythonUriFixture = `
import json
import sys
import types
from pathlib import Path

emitted = []
bridge_module = types.ModuleType("wasm_idle_lsp_bridge")
bridge_module.emit = lambda payload: emitted.append(json.loads(payload))
sys.modules[bridge_module.__name__] = bridge_module

class FixtureScript:
    def __init__(self, **kwargs):
        pass

    def get_names(self, **kwargs):
        return self.goto()

    def goto(self, **kwargs):
        return [types.SimpleNamespace(
            name="target",
            type="function",
            line=1,
            column=4,
            full_name="main.target",
            module_path=Path(case["modulePath"]) if case["modulePath"] else None,
        )]

jedi_module = types.ModuleType("jedi")
jedi_module.Project = lambda **kwargs: None
jedi_module.Script = FixtureScript
sys.modules[jedi_module.__name__] = jedi_module

server_module = types.ModuleType("wasm_idle_python_lsp_test")
exec(compile(_server_source, "server.py", "exec"), server_module.__dict__)

results = []
for case in json.loads(_uri_cases):
    emitted.clear()
    server = server_module.WasmIdlePythonLsp()
    server.handle(json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"rootUri": "file:///workspace"},
    }))
    server.handle(json.dumps({
        "jsonrpc": "2.0", "method": "textDocument/didOpen",
        "params": {"textDocument": {
            "uri": case["requestUri"], "languageId": "python", "version": 1,
            "text": "def target():\\n    pass\\n",
        }},
    }))
    server.handle(json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": case["method"],
        "params": {
            "textDocument": {"uri": case["requestUri"]},
            "position": {"line": 0, "character": 4},
        },
    }))
    results.append(next(message for message in emitted if message.get("id") == 2))

json.dumps(results)
`;

describe('Python server location URIs', () => {
	let responses: Array<{ jsonrpc: string; id: number; result?: unknown; error?: unknown }>;

	beforeAll(async () => {
		const serverPath = fileURLToPath(
			new URL('../src/python/package/wasm_idle_python_lsp/server.py', import.meta.url)
		);
		const childSource = `
import { readFile } from 'node:fs/promises';
import { loadPyodide } from 'pyodide';
const pyodide = await loadPyodide();
pyodide.globals.set('_server_source', await readFile(process.argv[1], 'utf8'));
pyodide.globals.set('_uri_cases', process.argv[2]);
process.stdout.write(pyodide.runPython(${JSON.stringify(pythonUriFixture)}));
`;
		const { stdout } = await promisify(execFile)(
			process.execPath,
			[
				'--experimental-wasm-stack-switching',
				'--input-type=module',
				'-e',
				childSource,
				serverPath,
				JSON.stringify(uriCases)
			],
			{ cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30_000 }
		);
		responses = JSON.parse(stdout);
	}, 40_000);

	it.each(uriCases)('$name', (fixture) => {
		const location = {
			uri: fixture.expectedUri,
			range: {
				start: { line: 0, character: 4 },
				end: { line: 0, character: 10 }
			}
		};
		expect(responses[uriCases.indexOf(fixture)]).toEqual({
			jsonrpc: '2.0',
			id: 2,
			result:
				fixture.method === 'textDocument/documentSymbol'
					? [{ name: 'target', kind: 12, location, containerName: 'main.target' }]
					: [location]
		});
	});
});
