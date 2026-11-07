const encoder = new TextEncoder();
const name = (value: string) => [...uint(encoder.encode(value).length), ...encoder.encode(value)];
const section = (id: number, bytes: number[]) => [id, ...uint(bytes.length), ...bytes];

// Binary transport/engine fixtures only; these do not qualify a compiler or C++ runtime.
// WABT 1.0.37 --enable-exceptions independently assembled this nested catch/rethrow.
export const modernExceptionBody = [
	0, 2, 127, 31, 64, 1, 0, 0, 0, 2, 2, 31, 64, 1, 1, 0, 0, 65, 42, 8, 0, 11, 0, 11, 10, 11, 0, 11,
	26, 11
];
export function exceptionProgram(
	body = modernExceptionBody,
	tagType: number | null = 0,
	modernType = true,
	extra: number[] = []
) {
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(
			1,
			modernType
				? [3, 0x60, 1, 0x7f, 0, 0x60, 0, 0, 0x60, 0, 2, 0x7f, 0x69]
				: [2, 0x60, 1, 0x7f, 0, 0x60, 0, 0]
		),
		...section(3, [1, 1]),
		...section(5, [1, 0, 1]),
		...(tagType === null ? [] : section(13, [1, 0, tagType])),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, 0]),
		...section(10, [1, body.length, ...body]),
		...extra
	]);
}

const uint = (value: number): number[] => {
	const bytes: number[] = [];
	do {
		const byte = value & 127;
		value >>>= 7;
		bytes.push(byte | (value ? 128 : 0));
	} while (value);
	return bytes;
};
const custom = (key: string, bytes: number[]) => section(0, [...name(key), ...bytes]);

export function exceptionObject(
	options: {
		defined?: boolean;
		noFeature?: boolean;
		prohibit?: boolean;
		wrongSymbol?: boolean;
		wrongOffset?: boolean;
		noRelocation?: boolean;
		duplicateRelocation?: boolean;
		modern?: boolean;
		noMultivalue?: boolean;
		prohibitMultivalue?: boolean;
	} = {}
) {
	// Both immediates are padded: only the throw's tag operand may carry relocation10.
	const body = options.modern
		? [
				0, 2, 2, 31, 64, 1, 1, 0x80, 0x80, 0x80, 0x80, 0, 0, 65, 42, 8, 0x80, 0x80, 0x80,
				0x80, 0, 11, 0, 11, 26, 26, 11
			]
		: [0, 0x41, 0xaa, 0x80, 0x80, 0x80, 0, 0x08, 0x80, 0x80, 0x80, 0x80, 0, 0x0b];
	const relocation = [10, options.wrongOffset ? 4 : 10, options.wrongSymbol ? 0 : 1];
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
			options.modern ? 3 : 2,
			0x60,
			1,
			0x7f,
			0,
			0x60,
			0,
			0,
			...(options.modern ? [0x60, 0, 2, 0x7f, 0x69] : [])
		]),
		...(options.defined
			? []
			: section(2, [1, ...name('env'), ...name('__cpp_exception'), 4, 0, 0])),
		...section(3, [1, 1]),
		...(options.defined ? section(13, [1, 0, 0]) : []),
		...section(10, [1, ...uint(body.length), ...body]),
		...custom('linking', [
			2,
			...section(8, [
				2,
				0,
				0,
				0,
				...name('helper'),
				4,
				options.defined ? 0 : 0x10,
				0,
				...(options.defined ? name('__cpp_exception') : [])
			])
		]),
		...(options.noRelocation
			? []
			: custom(
					'reloc.CODE',
					options.modern
						? [3, 2, 10, 9, 1, 10, 18, 1]
						: [
								3,
								options.duplicateRelocation ? 2 : 1,
								...relocation,
								...(options.duplicateRelocation ? relocation : [])
							]
				)),
		...(options.noFeature
			? []
			: custom('target_features', [
					options.modern && !options.noMultivalue ? 2 : 1,
					options.prohibit ? 45 : 43,
					...name('exception-handling'),
					...(options.modern && !options.noMultivalue
						? [options.prohibitMultivalue ? 45 : 43, ...name('multivalue')]
						: [])
				]))
	]);
}
