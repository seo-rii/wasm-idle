import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WASM_FENNEL_COMPILER_RECEIPT } from './wasmFennelVersion';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_LUA_MODULE_URL: '',
		PUBLIC_WASM_FENNEL_COMPILER_URL: ''
	}
}));

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.fnl',
							lineNumber: 2,
							columnNumber: 2,
							severity: 'error',
							message: 'Compile error: unknown identifier: foo'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: { error: 'Fennel compilation failed' }
				} as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'fibonacci=11\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/lua?worker', () => ({
	default: MockWorker
}));

vi.mock('$app/env/public', async () => {
	const { mockPublicEnv } = await import('../testPublicEnv');
	return mockPublicEnv(publicEnv);
});

import Fennel from './fennel';

describe('Fennel sandbox', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_LUA_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_FENNEL_COMPILER_URL = '';
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the wasm-lua worker with the receipt-pinned Fennel compiler', async () => {
		const sandbox = new Fennel();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run('(print (io.read))', false, true, undefined, ['5'], { stdin: '5\n' })
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, {
			load: true,
			moduleUrl: expect.stringMatching(/\/absproxy\/5173\/wasm-lua\/index\.js$/),
			fennelCompiler: {
				url: expect.stringMatching(
					/\/absproxy\/5173\/wasm-fennel\/fennel-1\.6\.1\.lua\.gz$/
				),
				receipt: { ...WASM_FENNEL_COMPILER_RECEIPT }
			}
		});
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: false,
				code: '(print (io.read))',
				args: ['5'],
				stdin: '5\n',
				activePath: 'main.fnl'
			})
		);
		expect(outputs).toEqual(['fibonacci=11\n']);
	});

	it('prefers explicit runtime asset URLs for the Lua VM and Fennel compiler', async () => {
		const sandbox = new Fennel();
		await sandbox.load({
			lua: { moduleUrl: 'https://cdn.example.com/wasm-lua/index.js' },
			fennel: { compilerUrl: 'https://cdn.example.com/fennel.lua.gz?v=1' }
		});
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				moduleUrl: 'https://cdn.example.com/wasm-lua/index.js',
				fennelCompiler: expect.objectContaining({
					url: 'https://cdn.example.com/fennel.lua.gz?v=1'
				})
			})
		);
	});

	it('replaces the worker when the Fennel compiler URL changes', async () => {
		const sandbox = new Fennel();
		const lua = { moduleUrl: '/wasm-lua/index.js' };
		await sandbox.load({ lua, fennel: { compilerUrl: '/wasm-fennel/a.lua.gz' } });
		await sandbox.load({ lua, fennel: { compilerUrl: '/wasm-fennel/a.lua.gz' } });
		expect(workerInstances).toHaveLength(1);
		await sandbox.load({ lua, fennel: { compilerUrl: '/wasm-fennel/b.lua.gz' } });
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalled();
	});

	it('rejects startup when the Fennel compiler is not configured', async () => {
		const sandbox = new Fennel();
		await expect(
			sandbox.load({ lua: { moduleUrl: '/wasm-lua/index.js' } })
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			message: expect.stringContaining('Fennel compiler is not configured')
		});
		expect(workerInstances).toHaveLength(0);
	});

	it('forwards compiler diagnostics and labels runtime errors as Fennel', async () => {
		const sandbox = new Fennel();
		const diagnostics: any[] = [];
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);
		await sandbox.load('/');
		await expect(sandbox.run('(foo)', true)).rejects.toBe('Fennel compilation failed');
		expect(diagnostics).toEqual([
			expect.objectContaining({ fileName: 'main.fnl', lineNumber: 2, severity: 'error' })
		]);

		workerInstances[0].postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('(print 1)', false);
		await expect(sandbox.run('(print 2)', false)).rejects.toMatchObject({
			name: 'BusyError',
			message: 'Fennel runtime already has an active operation',
			runtimeId: 'FENNEL'
		});
		sandbox.terminate('stopped');
		await expect(running).rejects.toBe('stopped');
	});
});
