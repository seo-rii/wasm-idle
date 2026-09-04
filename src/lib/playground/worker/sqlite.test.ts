import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importRuntimeModuleMock } = vi.hoisted(() => ({
	importRuntimeModuleMock: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: importRuntimeModuleMock
}));

async function loadWorker() {
	await import('./sqlite');
	await (globalThis as any).self.onmessage({
		data: {
			load: true,
			moduleUrl: '/wasm-sqlite/runtime.mjs'
		}
	});
}

describe('SQLite worker', () => {
	beforeEach(() => {
		vi.resetModules();
		importRuntimeModuleMock.mockReset();
		importRuntimeModuleMock.mockImplementation(async () => ({
			default: (await import('sql.js')).default,
			sqliteWasmUrl: '/node_modules/sql.js/dist/sql-wasm.wasm'
		}));
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
	});

	it('executes SQL and prints result sets as tab-separated tables', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'SELECT 1;',
				prepare: true,
				activePath: 'main.sql',
				workspaceFiles: []
			}
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: `CREATE TABLE numbers (n INTEGER NOT NULL);
INSERT INTO numbers VALUES (4);
SELECT 'factorial_plus_bonus=' || 27 AS result;`,
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: []
			}
		});

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		const readyIndex = messages.findIndex((message: any) => message.progress?.kind === 'ready');
		expect(messages.filter((message: any) => message.progress?.kind === 'ready')).toEqual([
			{
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'SQLite query started'
				}
			}
		]);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(
			messages.findIndex(
				(message: any) => message.output === 'result\nfactorial_plus_bonus=27\n'
			)
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'result\nfactorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	}, 15000);

	it('reports ready after every workspace setup query and before the main query', async () => {
		const exec = vi.fn(() => []);
		const close = vi.fn();
		importRuntimeModuleMock.mockResolvedValue({
			default: vi.fn(async () => ({
				Database: vi.fn(function MockDatabase() {
					return { close, exec };
				})
			})),
			sqliteWasmUrl: '/sqlite.wasm'
		});

		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'SELECT * FROM numbers;',
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: [
					{ path: 'schema.sql', content: 'CREATE TABLE numbers(n INTEGER);' },
					{ path: 'seed.sql', content: 'INSERT INTO numbers VALUES (5);' },
					{ path: 'main.sql', content: 'SELECT 0;' }
				]
			}
		});

		const readyCall = (globalThis as any).postMessage.mock.calls.findIndex(
			([message]: [any]) => message.progress?.kind === 'ready'
		);
		expect(exec).toHaveBeenNthCalledWith(1, 'CREATE TABLE numbers(n INTEGER);');
		expect(exec).toHaveBeenNthCalledWith(2, 'INSERT INTO numbers VALUES (5);');
		expect(exec).toHaveBeenNthCalledWith(3, 'SELECT * FROM numbers;');
		expect(exec.mock.invocationCallOrder[1]).toBeLessThan(
			(globalThis as any).postMessage.mock.invocationCallOrder[readyCall]
		);
		expect((globalThis as any).postMessage.mock.invocationCallOrder[readyCall]).toBeLessThan(
			exec.mock.invocationCallOrder[2]
		);
		expect(close).toHaveBeenCalledOnce();
	});

	it('does not report ready when a workspace setup query fails', async () => {
		const exec = vi.fn((sql: string) => {
			if (sql.includes('BROKEN SETUP')) throw new Error('bad sqlite setup');
			return [];
		});
		const close = vi.fn();
		importRuntimeModuleMock.mockResolvedValue({
			default: vi.fn(async () => ({
				Database: vi.fn(function MockDatabase() {
					return { close, exec };
				})
			})),
			sqliteWasmUrl: '/sqlite.wasm'
		});

		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'SELECT 1;',
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: [{ path: 'setup.sql', content: 'BROKEN SETUP;' }]
			}
		});

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'bad sqlite setup' });
		expect(exec).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});

	it('reports SQLite execution failures as worker errors', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'select missing from nowhere;',
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('no such table')
		});
	}, 15000);
});
