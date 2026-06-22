import { beforeEach, describe, expect, it, vi } from 'vitest';

const duckdbMock = vi.hoisted(() => {
	const query = vi.fn();
	const close = vi.fn(async () => {});
	const connection = { query, close };
	const db = {
		connect: vi.fn(async () => connection),
		instantiate: vi.fn(async () => {}),
		registerFileBuffer: vi.fn(async () => {}),
		registerFileText: vi.fn(async () => {}),
		reset: vi.fn(async () => {})
	};
	const selectBundle = vi.fn(async () => ({
		mainModule: '/duckdb-mvp.wasm',
		mainWorker: '/duckdb-browser.worker.js',
		pthreadWorker: '/duckdb-pthread.worker.js'
	}));
	const AsyncDuckDB = vi.fn(function MockAsyncDuckDB() {
		return db;
	});
	const ConsoleLogger = vi.fn(function MockConsoleLogger() {});
	const VoidLogger = vi.fn(function MockVoidLogger() {});

	function reset() {
		query.mockReset();
		close.mockClear();
		db.connect.mockClear();
		db.instantiate.mockClear();
		db.registerFileBuffer.mockClear();
		db.registerFileText.mockClear();
		db.reset.mockClear();
		selectBundle.mockClear();
		AsyncDuckDB.mockClear();
		ConsoleLogger.mockClear();
		VoidLogger.mockClear();
	}

	return {
		AsyncDuckDB,
		ConsoleLogger,
		VoidLogger,
		close,
		connection,
		db,
		query,
		reset,
		selectBundle
	};
});

vi.mock('@duckdb/duckdb-wasm', () => duckdbMock);
vi.mock('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url', () => ({
	default: '/duckdb-eh.wasm'
}));
vi.mock('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url', () => ({
	default: '/duckdb-browser-eh.worker.js'
}));
vi.mock('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url', () => ({
	default: '/duckdb-mvp.wasm'
}));
vi.mock('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url', () => ({
	default: '/duckdb-browser-mvp.worker.js'
}));

describe('DuckDB worker', () => {
	beforeEach(() => {
		vi.resetModules();
		duckdbMock.reset();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).Worker = vi.fn(function MockWorker(this: { url: string }, url: string) {
			this.url = url;
		});
	});

	it('loads DuckDB-Wasm and executes workspace setup plus the active query', async () => {
		duckdbMock.query.mockResolvedValue({
			numCols: 2,
			numRows: 1,
			schema: {
				fields: [{ name: 'label' }, { name: 'value' }]
			},
			get: () => ({
				label: 'factorial_plus_bonus',
				value: 27n
			})
		});

		await import('./duckdb');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				log: false
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: "SELECT 'factorial_plus_bonus' AS label, 27 AS value;",
				prepare: false,
				activePath: 'main.duckdb',
				stdin: '5\n',
				workspaceFiles: [
					{ path: 'setup.sql', content: 'CREATE TABLE numbers(n INTEGER);' },
					{ path: 'main.duckdb', content: 'SELECT 0;' },
					{ path: 'data.csv', content: 'n\n5\n' }
				]
			}
		});

		expect(duckdbMock.selectBundle).toHaveBeenCalledWith({
			eh: {
				mainModule: '/duckdb-eh.wasm',
				mainWorker: '/duckdb-browser-eh.worker.js'
			},
			mvp: {
				mainModule: '/duckdb-mvp.wasm',
				mainWorker: '/duckdb-browser-mvp.worker.js'
			}
		});
		expect((globalThis as any).Worker).toHaveBeenCalledWith('/duckdb-browser.worker.js');
		expect(duckdbMock.db.instantiate).toHaveBeenCalledWith(
			'/duckdb-mvp.wasm',
			'/duckdb-pthread.worker.js'
		);
		expect(duckdbMock.db.reset).toHaveBeenCalledTimes(1);
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith(
			'setup.sql',
			'CREATE TABLE numbers(n INTEGER);'
		);
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith(
			'main.duckdb',
			"SELECT 'factorial_plus_bonus' AS label, 27 AS value;"
		);
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith('data.csv', 'n\n5\n');
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith('stdin.txt', '5\n');
		expect(duckdbMock.db.registerFileBuffer).toHaveBeenCalledWith(
			'/dev/stdin',
			new TextEncoder().encode('5\n')
		);
		expect(duckdbMock.query).toHaveBeenNthCalledWith(1, 'CREATE TABLE numbers(n INTEGER);');
		expect(duckdbMock.query).toHaveBeenNthCalledWith(
			2,
			"SELECT 'factorial_plus_bonus' AS label, 27 AS value;"
		);
		expect(duckdbMock.close).toHaveBeenCalledTimes(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'label\tvalue\nfactorial_plus_bonus\t27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reports DuckDB execution failures as worker errors', async () => {
		duckdbMock.query.mockRejectedValue(new Error('bad duckdb sql'));

		await import('./duckdb');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'select missing from nowhere;',
				prepare: false,
				activePath: 'main.duckdb',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'bad duckdb sql'
		});
		expect(duckdbMock.close).toHaveBeenCalledTimes(1);
	});
});
