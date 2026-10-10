// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { importRuntimeModuleMock } = vi.hoisted(() => ({
	importRuntimeModuleMock: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: importRuntimeModuleMock
}));

const pgliteDist = path.resolve('node_modules/@electric-sql/pglite/dist');
const assetUrl = (name: string) => `https://assets.example.test/wasm-postgresql/${name}`;

let worker: { onmessage(event: { data: any }): Promise<void> };
let postMessageMock: ReturnType<typeof vi.fn>;

async function send(data: Record<string, unknown>) {
	postMessageMock.mockClear();
	await worker.onmessage({ data });
	return postMessageMock.mock.calls.map(([message]) => message);
}

async function run(code: string, extra: Record<string, unknown> = {}) {
	return await send({
		code,
		prepare: false,
		activePath: 'main.sql',
		workspaceFiles: [],
		...extra
	});
}

describe('PostgreSQL worker', () => {
	beforeAll(async () => {
		importRuntimeModuleMock.mockImplementation(async () => ({
			loadPGlite: async () => (await import('@electric-sql/pglite')).PGlite,
			pgliteWasmUrl: assetUrl('pglite.wasm'),
			pgliteInitdbWasmUrl: assetUrl('initdb.wasm'),
			pgliteDataUrl: assetUrl('pglite.data')
		}));
		vi.stubGlobal('fetch', async (input: string) => {
			const name = String(input).slice(assetUrl('').length);
			return new Response(await readFile(path.join(pgliteDist, name)));
		});
		postMessageMock = vi.fn();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = postMessageMock;
		await import('./postgresql');
		worker = (globalThis as any).self;
		expect(await send({ load: true, moduleUrl: '/wasm-postgresql/runtime.mjs' })).toEqual([
			{ load: true }
		]);
	}, 120_000);

	beforeEach(() => {
		postMessageMock.mockClear();
	});

	it('runs real PostgreSQL and prints result sets as tab-separated tables', async () => {
		const messages = await run(`CREATE TABLE numbers (n integer NOT NULL, label text);
INSERT INTO numbers VALUES (4, 'four'), (5, NULL);
SELECT n, label, n * 1.5 AS scaled, n > 4 AS big FROM numbers ORDER BY n;
SELECT split_part(version(), ' ', 1) AS engine;`);

		const readyIndex = messages.findIndex((message) => message.progress?.kind === 'ready');
		const outputIndex = messages.findIndex((message) => message.output !== undefined);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(outputIndex);
		expect(messages[readyIndex]).toEqual({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'PostgreSQL query started'
			}
		});
		expect(messages[outputIndex]).toEqual({
			output: 'n\tlabel\tscaled\tbig\n4\tfour\t6.0\tf\n5\tNULL\t7.5\tt\nengine\nPostgreSQL\n'
		});
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('exposes stdin as /dev/blob for COPY and pg_read_file', async () => {
		const messages = await run(
			`CREATE TABLE input_numbers (n integer);
COPY input_numbers FROM '/dev/blob';
SELECT 'main=' || (sum(n) + 5) AS result FROM input_numbers;
SELECT length(pg_read_file('/dev/blob')) AS bytes;`,
			{ stdin: '30\n38\n' }
		);

		expect(messages).toContainEqual({ output: 'result\nmain=73\nbytes\n6\n' });
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('starts every run from a fresh database cluster', async () => {
		expect((await run('CREATE TABLE leftovers (id int);')).at(-1)).toEqual({ results: true });
		const messages = await run(`SELECT to_regclass('leftovers') IS NULL AS fresh;`);
		expect(messages).toContainEqual({ output: 'fresh\nt\n' });
	});

	it('streams notices and COPY TO STDOUT in server order', async () => {
		const messages = await run(`DO $$ BEGIN RAISE NOTICE 'hello %', 42; END $$;
COPY (SELECT 1 AS a, 'x' AS b) TO STDOUT;`);
		expect(messages).toContainEqual({ output: 'NOTICE:  hello 42\n1\tx\n' });
	});

	it('keeps earlier output and reports server errors with source positions', async () => {
		const messages = await run(`SELECT 1 AS ok;
SELECT missing_column
FROM (SELECT 1) AS t;`);

		expect(messages).toContainEqual({ output: 'ok\n1\n' });
		expect(messages).toContainEqual({
			diagnostic: {
				fileName: 'main.sql',
				lineNumber: 2,
				columnNumber: 8,
				severity: 'error',
				message: 'column "missing_column" does not exist'
			}
		});
		expect(messages.at(-1)).toEqual({
			error: 'ERROR:  column "missing_column" does not exist'
		});
	});

	it('runs other workspace .sql files before the active script', async () => {
		const messages = await run('SELECT name FROM people ORDER BY name;', {
			workspaceFiles: [
				{ path: 'main.sql', content: 'ignored' },
				{ path: 'schema/02-data.sql', content: "INSERT INTO people VALUES ('Ada');" },
				{ path: 'schema/01-table.sql', content: 'CREATE TABLE people (name text);' },
				{ path: 'notes.txt', content: 'not sql' }
			]
		});
		expect(messages).toContainEqual({ output: 'name\nAda\n' });
	});

	it('acknowledges prepare requests without executing SQL', async () => {
		const messages = await send({ code: 'SELECT 1/0;', prepare: true });
		expect(messages).toEqual([{ results: true }]);
	});
});
