import { beforeEach, describe, expect, it, vi } from 'vitest';

// These fixtures exercise worker lifecycle and the raw Arrow display columns.
// The query planner is exercised against the real engine in duckdbResult.test.ts.
vi.mock('./duckdbResult', () => ({
	queryDuckDbResult: (_db: unknown, connection: { query(sql: string): unknown }, sql: string) =>
		connection.query(sql)
}));

const { importRuntimeModuleMock } = vi.hoisted(() => ({
	importRuntimeModuleMock: vi.fn()
}));

const duckdbMock = vi.hoisted(() => {
	const query = vi.fn();
	const close = vi.fn(async () => {});
	const connection = { query, close };
	const db = {
		connect: vi.fn(async () => connection),
		instantiate: vi.fn(async () => {}),
		dropFiles: vi.fn(async () => {}),
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
		db.dropFiles.mockClear();
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

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: importRuntimeModuleMock
}));

async function loadWorker() {
	await import('./duckdb');
	await (globalThis as any).self.onmessage({
		data: {
			load: true,
			moduleUrl: '/wasm-duckdb/runtime.mjs',
			log: false
		}
	});
}

describe('DuckDB worker', () => {
	beforeEach(() => {
		vi.resetModules();
		duckdbMock.reset();
		importRuntimeModuleMock.mockReset();
		importRuntimeModuleMock.mockResolvedValue({
			duckdb: duckdbMock,
			bundles: {
				eh: {
					mainModule: '/duckdb-eh.wasm',
					mainWorker: '/duckdb-browser-eh.worker.js'
				},
				mvp: {
					mainModule: '/duckdb-mvp.wasm',
					mainWorker: '/duckdb-browser-mvp.worker.js'
				}
			}
		});
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
				fields: [
					{ name: 'label', type: { typeId: 5 } },
					{ name: 'value', type: { typeId: 2 } }
				]
			},
			getChildAt: (column: number) => ({ get: () => ['factorial_plus_bonus', 27n][column] })
		});

		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: "SELECT 'factorial_plus_bonus' AS label, 27 AS value;",
				prepare: true,
				activePath: 'main.duckdb',
				workspaceFiles: []
			}
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
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
		const readyCallIndex = (globalThis as any).postMessage.mock.calls.findIndex(
			([message]: [any]) => message.progress?.kind === 'ready'
		);
		expect((globalThis as any).postMessage.mock.calls[readyCallIndex]?.[0]).toEqual({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'DuckDB query started'
			}
		});
		expect(readyCallIndex).toBeGreaterThanOrEqual(0);
		expect(duckdbMock.db.connect.mock.invocationCallOrder[0]).toBeLessThan(
			(globalThis as any).postMessage.mock.invocationCallOrder[readyCallIndex]
		);
		expect(duckdbMock.query.mock.invocationCallOrder[0]).toBeLessThan(
			(globalThis as any).postMessage.mock.invocationCallOrder[readyCallIndex]
		);
		expect(
			(globalThis as any).postMessage.mock.invocationCallOrder[readyCallIndex]
		).toBeLessThan(duckdbMock.query.mock.invocationCallOrder[1]);
		expect(duckdbMock.close).toHaveBeenCalledTimes(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'label\tvalue\nfactorial_plus_bonus\t27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('replaces registered files on every run and mounts binary slices without transferring workspace memory', async () => {
		duckdbMock.query.mockResolvedValue({ numCols: 0 });
		await loadWorker();
		const bytes = new Uint8Array([1, 80, 65, 82, 49, 2]).subarray(1, 5);
		const workspaceFiles = [
			{ path: 'parts/table.parquet', content: bytes },
			{ path: 'stdin.txt', content: 'workspace file' }
		];
		const run = (files: typeof workspaceFiles) =>
			(globalThis as any).self.onmessage({ data: { code: 'SELECT 1', workspaceFiles: files, stdin: 'stdin' } });
		await run(workspaceFiles);
		const firstRegistration = duckdbMock.db.registerFileBuffer.mock.invocationCallOrder[0];
		expect(duckdbMock.db.dropFiles.mock.invocationCallOrder[0]).toBeLessThan(firstRegistration);
		expect(duckdbMock.db.registerFileBuffer).toHaveBeenCalledWith('parts/table.parquet', bytes);
		const mounted = vi.mocked(duckdbMock.db.registerFileBuffer).mock.calls[0] as unknown as [string, Uint8Array];
		expect(mounted[1].buffer).not.toBe(bytes.buffer);
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith('stdin.txt', 'workspace file');
		expect(duckdbMock.db.registerFileText).not.toHaveBeenCalledWith('stdin.txt', 'stdin');
		expect(duckdbMock.db.registerFileBuffer).toHaveBeenCalledWith('/dev/stdin', new TextEncoder().encode('stdin'));
		await run([]);
		expect(duckdbMock.db.dropFiles).toHaveBeenCalledTimes(2);
		expect(duckdbMock.db.dropFiles.mock.invocationCallOrder[1]).toBeGreaterThan(firstRegistration);
		expect(duckdbMock.db.registerFileText).toHaveBeenCalledWith('stdin.txt', 'stdin');
	});

	it('prints repeated headings by ordinal and formats exact Arrow decimals and UTC dates', async () => {
		const fields = [
			{ name: 'twin', type: { typeId: 7, scale: 4 } },
			{ name: 'twin', type: { typeId: 8 } },
			{ name: 'timestamp', type: { typeId: 10 } }
		];
		const columns = [
			[-1n, 12345678901234567890123456789012345600n, 0n, null],
			[Date.UTC(1960, 1, 29), Date.UTC(2024, 0, 2), null, 0],
			[0, 1, 2, 3]
		];
		duckdbMock.query.mockResolvedValue({
			numCols: fields.length,
			numRows: 4,
			schema: { fields },
			getChildAt: (index: number) => ({ get: (row: number) => columns[index][row] })
		});
		await loadWorker();
		await (globalThis as any).self.onmessage({ data: { code: 'SELECT ...' } });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: [
				'twin\ttwin\ttimestamp',
				'-0.0001\t1960-02-29\t0',
				'1234567890123456789012345678901234.5600\t2024-01-02\t1',
				'0.0000\tNULL\t2',
				'NULL\t1970-01-01\t3',
				''
			].join('\n')
		});
	});

	it('renders timestamps from exact Arrow ticks across the epoch, preserving null and infinity', async () => {
		const columns = [
			[1_770_091_506_654_321_000n, 1_770_091_506_654_321_001n, -1n, 0n, 0n],
			[0n, 12_345_678n, 9_223_372_036_854_775_807n, -9_223_372_036_854_775_807n, -62_161_757_633_000_000n]
		];
		duckdbMock.query.mockResolvedValue({
			numCols: 2,
			numRows: 5,
			schema: { fields: [
				{ name: 'ns', type: { typeId: 10, unit: 3 } },
				{ name: 'tz', type: { typeId: 10, unit: 2, timezone: 'UTC' } }
			] },
			getChildAt: (index: number) => ({
				toArray: () => BigInt64Array.from(columns[index]),
				isValid: (row: number) => index !== 0 || row !== 3
			})
		});
		await loadWorker();
		await (globalThis as any).self.onmessage({ data: { code: 'SELECT ...' } });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: [
				'ns\ttz',
				'2026-02-03 04:05:06.654321\t1970-01-01 00:00:00+00',
				'2026-02-03 04:05:06.654321001\t1970-01-01 00:00:12.345678+00',
				'1969-12-31 23:59:59.999999999\tinfinity',
				'NULL\t-infinity',
				'1970-01-01 00:00:00\t0001-03-04 (BC) 05:06:07+00',
				''
			].join('\n')
		});
	});

	it('does not report ready when a workspace setup query fails', async () => {
		duckdbMock.query.mockRejectedValueOnce(new Error('bad duckdb setup'));

		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'SELECT * FROM numbers;',
				prepare: false,
				activePath: 'main.duckdb',
				workspaceFiles: [
					{ path: 'setup.sql', content: 'BROKEN SETUP;' },
					{ path: 'main.duckdb', content: 'SELECT 0;' }
				]
			}
		});

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'bad duckdb setup' });
		expect(duckdbMock.query).toHaveBeenCalledOnce();
		expect(duckdbMock.close).toHaveBeenCalledOnce();
	});

	it('reports DuckDB execution failures as worker errors', async () => {
		duckdbMock.query.mockRejectedValue(new Error('bad duckdb sql'));

		await loadWorker();
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
