import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { RecordBatchReader, Table, Type } from 'apache-arrow';

type ResultTable = Awaited<ReturnType<AsyncDuckDBConnection['query']>>;
type MaybePromise<T> = T | Promise<T>;
interface DisplayConnection {
	query(sql: string): MaybePromise<ResultTable>;
	insertArrowFromIPCStream(bytes: Uint8Array, options: { name: string }): MaybePromise<void>;
	close(): MaybePromise<void>;
}

// DuckDB returns an Arrow IPC file. Its padded file magic precedes an entire
// IPC stream, including the stream terminator. The little-endian footer size
// and trailing 6-byte magic follow the footer. Preserve the original messages
// when passing them back to DuckDB (including nested metadata and interval ticks).
function resultStream(file: Uint8Array) {
	const footerLength = new DataView(file.buffer, file.byteOffset + file.length - 10, 4).getUint32(
		0,
		true
	);
	return file.subarray(8, file.length - 10 - footerLength);
}

const displayTypes = new Set<Type>([
	Type.Time,
	Type.Interval,
	Type.List,
	Type.FixedSizeList,
	Type.Struct,
	Type.Map,
	Type.Union
]);

export async function queryDuckDbResult(
	readResult: () => MaybePromise<Uint8Array>,
	openDisplay: () => MaybePromise<DisplayConnection>
) {
	// Binding a query can itself consume a sequence, even in DESCRIBE or EXPLAIN.
	// Execute the user's SQL once and format only the returned Arrow values.
	const file = await readResult();
	const reader = RecordBatchReader.from(file).open();
	const fields = reader.schema.fields.slice();
	const format = fields.map(
		(field) => displayTypes.has(field.type.typeId) || field.metadata.has('ARROW:extension:name')
	);
	let table: ResultTable;
	if (format.some(Boolean)) {
		const display = await openDisplay();
		try {
			// This connection owns an uncommitted table. Closing it discards the
			// result even when formatting fails or the user's transaction is open.
			const name = 'wasm_idle_result_' + crypto.getRandomValues(new Uint32Array(4)).join('_');
			await display.query('BEGIN');
			await display.insertArrowFromIPCStream(resultStream(file), { name });
			const aliases = fields.map((_, i) => 'c' + i);
			const projection = aliases.map((alias, i) =>
				format[i] ? 'CAST(' + alias + ' AS VARCHAR) AS ' + alias : alias
			);
			table = await display.query(
				'SELECT ' +
					projection.join(', ') +
					' FROM ' +
					name +
					' AS result(' +
					aliases.join(', ') +
					')'
			);
		} finally {
			await display.close();
		}
	} else {
		table = new Table(reader);
	}
	// Arrow JS can replace the first field's metadata when result names repeat.
	// Keep DuckDB's original headings and read values by physical position.
	return {
		numCols: table.numCols,
		numRows: table.numRows,
		schema: {
			fields: fields.map((field, i) => ({
				name: field.name,
				type: format[i] ? table.schema.fields[i].type : field.type
			}))
		},
		getChildAt: (index: number) => table.getChildAt(index)
	};
}
