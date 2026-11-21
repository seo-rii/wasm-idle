// @vitest-environment node
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryDuckDbResult } from '../../../../scripts/runtime-modules/duckdb-result';

const require = createRequire(import.meta.url);
const duckdb =
	require('@duckdb/duckdb-wasm/blocking') as typeof import('@duckdb/duckdb-wasm/blocking');

describe('DuckDB result formatting', () => {
	let db: Awaited<ReturnType<typeof duckdb.createDuckDB>>;
	let connection: ReturnType<typeof db.connect>;
	beforeAll(async () => {
		const bundle = (family: string) => ({
			mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-' + family + '.wasm'),
			mainWorker: require.resolve(
				'@duckdb/duckdb-wasm/dist/duckdb-node-' + family + '.worker.cjs'
			)
		});
		db = await duckdb.createDuckDB(
			{ mvp: bundle('mvp'), eh: bundle('eh') },
			new duckdb.VoidLogger(),
			duckdb.NODE_RUNTIME
		);
		await db.instantiate(() => {});
		db.open({ arrowLosslessConversion: true });
		connection = db.connect();
	});
	afterAll(() => connection?.close());
	const query = (sql: string) =>
		queryDuckDbResult(
			() => connection.useUnsafe((bindings, id) => bindings.runQuery(id, sql)),
			() => db.connect()
		);

	it('retains timezone offsets, interval components, unsigned integers and nested logical values', async () => {
		const expressions = [
			"TIME '12:34:56.123456'",
			"TIMETZ '12:34:56.123456+03'",
			"TIMETZ '12:34:56.123456-03'",
			"INTERVAL '2 days'",
			"INTERVAL '-00:00:01.000001'",
			"INTERVAL '0 seconds'",
			"'340282366920938463463374607431768211455'::UHUGEINT",
			'0::UHUGEINT',
			'[1.23::DECIMAL(8,2),NULL,3.45::DECIMAL(8,2)]',
			"[DATE '2000-02-29']",
			"{'price': 12.34::DECIMAL(8,2), 'x': [42, NULL]}",
			"MAP(['a','b'], [1.2::DECIMAL(8,2), NULL])",
			"union_value(clock := TIMETZ '15:00:00-03')",
			'[42,NULL]::INTEGER[2]',
			'NULL::INTERVAL'
		];
		const result = await query('SELECT ' + expressions.map((x) => x + ' AS twin').join(', '));
		const control = connection.query(
			'SELECT ' + expressions.map((x) => '(' + x + ')::VARCHAR').join(', ')
		);
		expect(result.schema.fields.map((field) => field.name)).toEqual(
			expressions.map(() => 'twin')
		);
		for (let i = 0; i < expressions.length; i++) {
			expect(result.getChildAt(i)?.get(0), expressions[i]).toBe(
				control.getChildAt(i)?.get(0)
			);
		}
	});

	it('preserves the native vectors for existing decimals, large integers, timestamps, dates and blobs', async () => {
		const body =
			"1.2300::DECIMAL(10,4) AS n, 9223372036854775807::BIGINT AS i, TIMESTAMP_NS '2000-02-29 16:17:18.000000001' AS stamp, DATE '2000-02-29' AS d, from_hex('00FF') AS b, NULL::INTEGER AS missing";
		const original = connection.query('SELECT ' + body);
		const result = await query('SELECT ' + body + ", TIMETZ '15:00:00+03' AS clock");
		const fields = original.schema.fields;
		for (let i = 0; i < fields.length; i++) {
			expect(result.schema.fields[i].type.toString()).toBe(fields[i].type.toString());
			const reference = original.getChildAt(i)!;
			const actual = result.getChildAt(i)!;
			expect(actual.isValid(0)).toBe(reference.isValid(0));
			if (reference.isValid(0)) expect(actual.toArray()).toEqual(reference.toArray());
		}
	});

	it('runs the prefix and volatile view exactly once with native string and comment tokenization', async () => {
		const result = await query(`-- comment ;
			CREATE SEQUENCE ticks START 41; CREATE TABLE once(n INTEGER);
			INSERT INTO once VALUES (11); CREATE VIEW changing AS SELECT nextval('ticks')::UHUGEINT AS n;
			/* 한글; */ SELECT n AS "same;🙂", (SELECT sum(n) FROM once) AS "same;🙂", $$x;한글$$ AS label
			FROM changing; ; -- ignored ;
		`);
		expect(result.schema.fields.map((field) => field.name)).toEqual([
			'same;🙂',
			'same;🙂',
			'label'
		]);
		expect(result.getChildAt(0)?.get(0)).toBe('41');
		expect(result.getChildAt(1)?.get(0).toString()).toBe('11');
		expect(connection.query("SELECT currval('ticks')").getChildAt(0)?.get(0)).toBe(41n);
	});

	it('formats INSERT, UPDATE, DELETE and duplicate RETURNING columns without repeating mutations', async () => {
		const inserted =
			await query(`CREATE TABLE events (id INTEGER, clock TIMETZ, elapsed INTERVAL);
			INSERT INTO events VALUES (1, '12:34:56+03', INTERVAL '2 days') RETURNING *`);
		expect(inserted.getChildAt(1)?.get(0)).toBe('12:34:56+03');
		expect(inserted.getChildAt(2)?.get(0)).toBe('2 days');
		const updated = await query(
			"UPDATE events AS e SET id=id+1 RETURNING clock AS repeated, (elapsed + INTERVAL '1 day') AS repeated, id"
		);
		expect(updated.schema.fields.map((field) => field.name)).toEqual([
			'repeated',
			'repeated',
			'id'
		]);
		expect(updated.getChildAt(0)?.get(0)).toBe('12:34:56+03');
		expect(updated.getChildAt(1)?.get(0)).toBe('3 days');
		expect(updated.getChildAt(2)?.get(0)).toBe(2);
		const deleted = await query('DELETE FROM events RETURNING clock, elapsed');
		expect(deleted.numRows).toBe(1);
		expect(deleted.getChildAt(1)?.get(0)).toBe('2 days');
	});

	it('retains expression aliases, quoted targets, native NULL and exactly-once RETURNING effects', async () => {
		const q = await query(`CREATE SEQUENCE returnd START 9;
			CREATE TABLE "quoted values"(n INT, t TIMETZ);
			INSERT INTO "quoted values" VALUES(1,NULL) RETURNING t::TIMETZ AS t, nextval('returnd')::UHUGEINT serial`);
		expect(q.schema.fields.map((field) => field.name)).toEqual(['t', 'serial']);
		expect(q.getChildAt(0)?.get(0)).toBeNull();
		expect(q.getChildAt(1)?.get(0)).toBe('9');
		expect(connection.query("SELECT currval('returnd')").getChildAt(0)?.get(0)).toBe(9n);
		const empty = await query('UPDATE "quoted values" SET n=2 WHERE false RETURNING t, t AS t');
		expect(empty.numRows).toBe(0);
		expect(empty.schema.fields.map((field) => field.name)).toEqual(['t', 't']);
	});

	it('binds volatile table arguments, views and dynamic pivots exactly as one native query', async () => {
		const compare = async (suffix: string, body: string) => {
			const run = async (formatted: boolean) => {
				const name = 'probe_' + suffix + (formatted ? '_formatted' : '_control');
				const sql = ('CREATE SEQUENCE seq_name START 41; ' + body)
					.replaceAll('seq_name', name)
					.replaceAll('view_name', 'v_' + name);
				const table = formatted ? await query(sql) : connection.query(sql);
				return {
					headings: table.schema.fields.map((field) => field.name),
					value: table.getChildAt(0)?.get(0)?.toString(),
					sequence: connection
						.query("SELECT currval('" + name + "')")
						.getChildAt(0)
						?.get(0)
				};
			};
			expect(await run(true)).toEqual(await run(false));
		};
		await compare('range', "SELECT count(*) AS n FROM range(nextval('seq_name'))");
		await compare(
			'view',
			"CREATE VIEW view_name AS SELECT * FROM range(nextval('seq_name')); SELECT count(*) AS n FROM view_name"
		);
		await compare('pivot', "PIVOT (SELECT nextval('seq_name') AS n, 1 AS v) ON n USING sum(v)");
	});

	it('preserves the original statement and prepared-statement catalog seen through a view', async () => {
		connection.query(`CREATE TEMP VIEW inspect_run AS
			SELECT current_query() AS sql_text, (SELECT count(*) FROM duckdb_prepared_statements()) AS statements`);
		const sql =
			"/* run from the editor */ SELECT sql_text, statements, INTERVAL '2 days' AS duration FROM inspect_run";
		const result = await query(sql);
		expect(result.getChildAt(0)?.get(0)).toBe(sql);
		expect(result.getChildAt(1)?.get(0)).toBe(0n);
		expect(result.getChildAt(2)?.get(0)).toBe('2 days');
	});

	it('keeps the user transaction open while formatting RETURNING and respects rollback and commit', async () => {
		connection.query('CREATE TABLE user_transactions(n INTEGER, t TIMETZ)');
		const observe = db.connect();
		try {
			const inserted =
				await query(`BEGIN; INSERT INTO user_transactions VALUES (1, '10:30:00+03')
				RETURNING t AS value, t AS value`);
			expect(inserted.schema.fields.map((field) => field.name)).toEqual(['value', 'value']);
			expect(inserted.getChildAt(1)?.get(0)).toBe('10:30:00+03');
			expect(observe.query('SELECT n FROM user_transactions').numRows).toBe(0);
			await query('ROLLBACK');
			expect(connection.query('SELECT n FROM user_transactions').numRows).toBe(0);

			await query("BEGIN; INSERT INTO user_transactions VALUES (2, '05:00:00-03'); COMMIT");
			expect(observe.query('SELECT n FROM user_transactions').getChildAt(0)?.get(0)).toBe(2);
		} finally {
			observe.close();
		}
	});

	it('preserves committed prefix effects when the final statement fails to bind', async () => {
		connection.query('CREATE TABLE prefix_events(n INTEGER)');
		await expect(
			query('INSERT INTO prefix_events VALUES (9); SELECT * FROM missing_prefix_table')
		).rejects.toThrow(/missing_prefix_table/);
		expect(connection.query('SELECT n FROM prefix_events').getChildAt(0)?.toArray()).toEqual(
			new Int32Array([9])
		);
	});

	it('keeps MERGE-specific output and DuckDB parse failures from re-running prefix statements', async () => {
		const merged =
			await query(`CREATE TABLE merge_log(n INT, t TIMETZ); INSERT INTO merge_log VALUES (1,'04:00:00-03');
			MERGE INTO merge_log t USING (VALUES (1)) s(n) ON t.n=s.n
			WHEN MATCHED THEN UPDATE SET n=t.n+1 RETURNING merge_action, t.n, t.t`);
		expect(merged.getChildAt(0)?.get(0)).toBe('UPDATE');
		expect(merged.getChildAt(1)?.get(0)).toBe(2);
		expect(merged.getChildAt(2)?.get(0)).toBe('04:00:00-03');
		await expect(query('INSERT INTO merge_log(n) VALUES (5); SELECT 1 + )')).rejects.toThrow();
		await expect(
			query('INSERT INTO merge_log(n) VALUES (6); UPDATE merge_log SET n = + RETURNING n')
		).rejects.toThrow();
		expect(
			connection
				.query('SELECT sum(n)::INTEGER FROM merge_log')
				.getChildAt(0)
				?.get(0)
				.toString()
		).toBe('2');
	});
});
