import { name, section, uleb, sharedArtifact } from './atomic-fixtures.js';

// Object-format boundary fixtures, not compiler/runtime qualification.
export function tlsObject(
	options: {
		symbolFlags?: number;
		segmentFlags?: number;
		relocation?: number;
		relocationSymbol?: number;
		relocationOffset?: number;
		data?: number[];
		features?: string[];
		body?: number[];
	} = {}
) {
	const body = options.body ?? [0, 0x41, 0x80, 0x80, 0x80, 0x80, 0, 0x1a, 0x0b];
	const data = options.data ?? [37, 0, 0, 0];
	const symbols = [
		1,
		1,
		...uleb(options.symbolFlags ?? 0x100),
		...name('tls_value'),
		0,
		0,
		...uleb(data.length)
	];
	const segments = [1, ...name('.tdata'), 2, ...uleb(options.segmentFlags ?? 2)];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, [1, 0x60, 0, 0]),
		...section(3, [1, 0]),
		...section(5, [1, 0, 1]),
		...section(10, [1, ...uleb(body.length), ...body]),
		...section(11, [1, 0, 0x41, 0, 0x0b, ...uleb(data.length), ...data]),
		...section(0, [
			...name('linking'),
			2,
			8,
			...uleb(symbols.length),
			...symbols,
			5,
			...uleb(segments.length),
			...segments
		]),
		...section(0, [
			...name('reloc.CODE'),
			3,
			1,
			options.relocation ?? 21,
			options.relocationOffset ?? 4,
			options.relocationSymbol ?? 0,
			0
		]),
		...section(0, [
			...name('target_features'),
			(options.features ?? ['atomics', 'bulk-memory']).length,
			...(options.features ?? ['atomics', 'bulk-memory']).flatMap((feature) => [
				43,
				...name(feature)
			])
		])
	]);
}

const constant = (value: number) => {
	const bytes = [0x41];
	value |= 0;
	for (;;) {
		const next = value & 127;
		value >>= 7;
		const done = (value === 0 && !(next & 64)) || (value === -1 && Boolean(next & 64));
		bytes.push(next | (done ? 0 : 128));
		if (done) return bytes;
	}
};
export const tlsSharedProfile = {
	entry: 'entry',
	initialPages: 1,
	maximumPages: 1,
	reservedBytes: 32768
} as const;

export function tlsSharedFixture(
	options: {
		alignment?: number;
		size?: number;
		reservedLow?: number;
		reservedHigh?: number;
		base?: number;
		initGlobal?: number;
		initSegment?: number;
		startupGlobal?: number;
		dropTls?: boolean;
		dropOrdinary?: boolean;
		extraInitializer?: boolean;
		cleanupParameter?: boolean;
		trap?: boolean;
		cleanupTrap?: boolean;
		grow?: number;
		yield?: boolean;
		importName?: string;
		yield64?: boolean;
	} = {}
) {
	const imported = options.yield ? 1 : 0,
		low = options.reservedLow ?? 1040,
		high = options.reservedHigh ?? 33808;
	const global = (mutable: number, value: number) => [0x7f, mutable, ...constant(value), 0x0b];
	const exports = [
		['memory', 2, 0],
		['__stack_pointer', 3, 0],
		['__tls_base', 3, 1],
		['__tls_size', 3, 2],
		['__tls_align', 3, 3],
		['__data_end', 3, 4],
		['__heap_base', 3, 5],
		['__stack_low', 3, 6],
		['__stack_high', 3, 7],
		['__wasm_call_ctors', 0, imported],
		['__wasm_init_tls', 0, imported + 1],
		['entry', 0, imported + 2],
		['__wasm_call_thread_dtors', 0, imported + 3]
	] as const;
	const init = [
		0,
		0x20,
		0,
		0x24,
		options.initGlobal ?? 1,
		0x20,
		0,
		...constant(0),
		...constant(4),
		0xfc,
		8,
		options.initSegment ?? 0,
		0,
		...(options.extraInitializer ? [0xfc, 9, 0] : []),
		0x0b
	];
	const entry = [
		0,
		...(options.yield ? [0x10, 0, 0x1a] : []),
		...(options.trap ? [0x00] : []),
		...(options.grow === undefined ? [0x23, 1] : [...constant(options.grow), 0x40, 0]),
		0x0b
	];
	const cleanup = [
		0,
		...(options.cleanupTrap ? [0x00] : [0x23, 1, ...constant(99), 0x36, 2, 0]),
		0x0b
	];
	const startup = [
		0,
		0x02,
		0x40,
		0x02,
		0x40,
		0x02,
		0x40,
		...constant(1032),
		...constant(0),
		...constant(1),
		0xfe,
		0x48,
		2,
		0,
		0x0e,
		2,
		0,
		1,
		2,
		0x0b,
		...constant(1024),
		...constant(1024),
		0x24,
		options.startupGlobal ?? 1,
		...constant(0),
		...constant(4),
		0xfc,
		8,
		0,
		0,
		...constant(1028),
		...constant(0),
		...constant(4),
		0xfc,
		8,
		1,
		0,
		...constant(1032),
		...constant(2),
		0xfe,
		0x17,
		2,
		0,
		...constant(1032),
		...constant(-1),
		0xfe,
		0,
		2,
		0,
		0x1a,
		0x0c,
		1,
		0x0b,
		...constant(1032),
		...constant(1),
		0x42,
		0x7f,
		0xfe,
		1,
		2,
		0,
		0x1a,
		0x0b,
		...(options.dropTls ? [0xfc, 9, 0] : []),
		...(options.dropOrdinary === false ? [] : [0xfc, 9, 1]),
		0x0b
	];
	const bodies = [[0, 0x0b], init, entry, cleanup, startup];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, [
			4,
			0x60,
			0,
			0,
			0x60,
			1,
			0x7f,
			0,
			0x60,
			1,
			0x7f,
			1,
			0x7f,
			0x60,
			0,
			1,
			options.yield64 ? 0x7e : 0x7f
		]),
		...section(2, [
			1 + imported,
			...name('env'),
			...name('memory'),
			2,
			3,
			1,
			1,
			...(imported
				? [
						...name('wasi_snapshot_preview1'),
						...name(options.importName ?? 'sched_yield'),
						0,
						3
					]
				: [])
		]),
		...section(3, [5, 0, 1, 2, options.cleanupParameter ? 1 : 0, 0]),
		...section(6, [
			8,
			...global(1, high),
			...global(1, options.base ?? 0),
			...global(0, options.size ?? 4),
			...global(0, options.alignment ?? 16),
			...global(0, 1040),
			...global(0, high),
			...global(0, low),
			...global(0, high)
		]),
		...section(7, [
			exports.length,
			...exports.flatMap(([text, kind, index]) => [...name(text), kind, index])
		]),
		...section(8, [imported + 4]),
		...section(12, [2]),
		...section(10, [
			bodies.length,
			...bodies.flatMap((body) => [...uleb(body.length), ...body])
		]),
		...section(11, [2, 1, 4, 37, 0, 0, 0, 1, 4, 9, 0, 0, 0])
	]);
}

export const tlsSharedArtifact = (options: Parameters<typeof tlsSharedFixture>[0] = {}) => ({
	...sharedArtifact(),
	tls: true,
	sharedMemory: tlsSharedProfile,
	bytes: tlsSharedFixture(options)
});
