import { describe, expect, it, vi } from 'vitest';
import type { DebugVariable } from '@wasm-idle/core';
import { ZigDebugValues } from './zigDebugValues';

// The type names, field names, tags and pointer storage references match the
// pinned Zig -> Clang -> Chromium LLDB gate in zig-debug-browser-smoke.mjs.
const variable = (
	name: string,
	value: string,
	type = 'int',
	variablesReference = 0
): DebugVariable => ({ name, value, type, variablesReference });
const composite = (name: string, type: string, reference: number) =>
	variable(name, type, type, reference);
const optionalFields = (tag: string, payload = variable('payload', '7')) => [
	payload,
	variable('some', tag, 'unsigned char')
];
const sliceFields = (pointer: string, length: string) => [
	{ ...variable('ptr', pointer, 'unsigned char *', 99), memoryReference: '0x20' },
	variable('len', length, 'unsigned int')
];
function fixture(locals: DebugVariable[], children: Record<number, DebugVariable[]> = {}) {
	const backend = {
		variables: vi.fn(async (reference: number, start?: number, count?: number) => {
			const values = reference === 1 ? locals : (children[reference] ?? []);
			return values.slice(start ?? 0, count === undefined ? undefined : (start ?? 0) + count);
		}),
		readMemory: vi.fn(async (_reference: string, _offset: number, count: number) => ({
			address: _reference,
			data: new Uint8Array(count).fill(65),
			unreadableBytes: 0
		}))
	};
	return { backend, formatter: new ZigDebugValues(backend) };
}

describe('Zig values from native DWARF fields', () => {
	it('reads a byte slice by its pointee and exact length, retaining NUL and invalid UTF-8', async () => {
		const { backend, formatter } = fixture([composite('bytes', '[]u8', 2)], {
			2: sliceFields('0x00000100 "A"', '4')
		});
		backend.readMemory.mockResolvedValue({
			address: '0x100',
			data: Uint8Array.of(65, 0, 255, 10),
			unreadableBytes: 0
		});
		const [value] = await formatter.variables(1);
		expect(value).toMatchObject({
			value: 'len=4 "A\\x00\\xff\\x0a"',
			namedVariables: 2,
			indexedVariables: 4
		});
		expect(backend.readMemory).toHaveBeenCalledWith('0x100', 0, 4);
		expect(
			(await formatter.variables(2, 2, 4)).map(({ name, value }) => [name, value])
		).toEqual([
			['[0]', '65'],
			['[1]', '0'],
			['[2]', '255'],
			['[3]', '10']
		]);
		expect(backend.variables).not.toHaveBeenCalledWith(
			99,
			expect.anything(),
			expect.anything()
		);
	});

	it('preserves Unicode and reads nothing for an empty or absent slice', async () => {
		const { backend, formatter } = fixture(
			[
				composite('text', '[]const u8', 2),
				composite('empty', '[]u8', 3),
				composite('none', '?[]const u8', 4)
			],
			{
				2: sliceFields('0x100 "Zig ✓"', '7'),
				3: sliceFields('0x200', '0'),
				4: sliceFields('0x0', '2863311530')
			}
		);
		backend.readMemory.mockResolvedValue({
			address: '0x100',
			data: new TextEncoder().encode('Zig ✓'),
			unreadableBytes: 0
		});
		expect((await formatter.variables(1)).map((value) => value.value)).toEqual([
			'len=7 "Zig ✓"',
			'len=0 ""',
			'null'
		]);
		expect(backend.readMemory).toHaveBeenCalledTimes(1);
		expect(await formatter.variables(4)).toEqual([]);
	});

	it('bounds previews and indexed pages while honoring a later byte offset', async () => {
		const { backend, formatter } = fixture([composite('large', '[]u8', 2)], {
			2: sliceFields('0x100', '1000000')
		});
		const [value] = await formatter.variables(1);
		expect(value.indexedVariables).toBe(1000000);
		expect(value.value).toBe(`len=1000000 "${'A'.repeat(32)}"…`);
		expect(backend.readMemory).toHaveBeenLastCalledWith('0x100', 0, 32);
		const page = await formatter.variables(2, 102, 1000000);
		expect(page).toHaveLength(64);
		expect(page[0]).toMatchObject({ name: '[100]', value: '65', memoryReference: '0x164' });
		expect(backend.readMemory).toHaveBeenLastCalledWith('0x164', 0, 64);
		expect(await formatter.variables(2, Number.MAX_SAFE_INTEGER, 64)).toEqual([]);
	});

	it('does not reinterpret non-byte or zero-sized elements using a byte length', async () => {
		const { backend, formatter } = fixture([composite('zero', '[]void', 2)], {
			2: sliceFields('0xffffffff', '4294967295')
		});
		expect((await formatter.variables(1))[0]).toMatchObject({
			value: 'len=4294967295, ptr=0xffffffff',
			indexedVariables: 0
		});
		expect(backend.readMemory).not.toHaveBeenCalled();
		expect((await formatter.variables(2)).map((field) => field.name)).toEqual(['ptr', 'len']);
	});

	it('keeps unreadable or invalid slices distinct from empty slices', async () => {
		const { backend, formatter } = fixture(
			[composite('invalid', '[]u8', 2), composite('unreadable', '[]u8', 3)],
			{ 2: sliceFields('0xaaaaaaaa ""', '2863311530'), 3: sliceFields('0x100', '4') }
		);
		backend.readMemory.mockResolvedValue({
			address: '0x100',
			data: Uint8Array.of(65),
			unreadableBytes: 3
		});
		expect((await formatter.variables(1)).map((value) => value.value)).toEqual([
			'<unavailable: invalid slice range>',
			'len=4, ptr=0x100 <preview unavailable>'
		]);
		expect(backend.readMemory).toHaveBeenCalledTimes(1);
		expect((await formatter.variables(3)).map((field) => field.name)).toEqual(['ptr', 'len']);
	});

	it('hides inactive optional payloads, rejects invalid tags, and distinguishes nested null', async () => {
		const { formatter } = fixture(
			[
				composite('some', '?i32', 2),
				composite('none', '?i32', 3),
				composite('undefined', '?i32', 4),
				composite('nested', '??i32', 5)
			],
			{
				2: optionalFields("'\\x01'"),
				3: optionalFields("'\\0'", variable('payload', '-1431655766')),
				4: optionalFields("'\\xaa'"),
				5: optionalFields("'\\x01'", composite('payload', '?i32', 6)),
				6: optionalFields("'\\0'")
			}
		);
		expect((await formatter.variables(1)).map((value) => value.value)).toEqual([
			'some(7)',
			'null',
			'<unavailable: invalid optional tag>',
			'some(null)'
		]);
		expect(await formatter.variables(2)).toEqual([variable('payload', '7')]);
		expect(await formatter.variables(3)).toEqual([]);
		expect(await formatter.variables(4)).toEqual([]);
		expect((await formatter.variables(5))[0]).toMatchObject({
			name: 'payload',
			value: 'null',
			variablesReference: 0
		});
	});

	it('recognizes nullable pointers with or without native children', async () => {
		const { backend, formatter } = fixture([
			variable('none', '0x00000000', '?*i32'),
			variable('some', '0x100', '?*i32', 2),
			variable('missing', '<unavailable>', '?*i32', 3)
		]);
		expect((await formatter.variables(1)).map((value) => value.value)).toEqual([
			'null',
			'some(0x100)',
			'<unavailable>'
		]);
		expect(backend.variables).toHaveBeenCalledTimes(1);
		expect(backend.readMemory).not.toHaveBeenCalled();
	});

	it('uses error enum names, hiding inactive payloads including void and invalid tags', async () => {
		const { formatter } = fixture(
			[
				composite('ok', 'error{Bad}!i32', 2),
				composite('err', 'error{Bad}!i32', 3),
				composite('void', 'error{Bad}!void', 4),
				composite('voidError', 'error{Bad}!void', 5),
				composite('invalid', 'anyerror!i32', 6)
			],
			{
				2: [variable('error', 'null', 'error{Bad}'), variable('payload', '7')],
				3: [
					variable('error', 'error.Bad', 'error{Bad}'),
					variable('payload', '-1431655766')
				],
				4: [variable('error', 'null', 'error{Bad}')],
				5: [variable('error', 'error.Bad', 'error{Bad}')],
				6: [variable('error', '43690', 'anyerror'), variable('payload', '-1431655766')]
			}
		);
		expect((await formatter.variables(1)).map((value) => value.value)).toEqual([
			'7',
			'error.Bad',
			'{}',
			'error.Bad',
			'<unavailable: invalid error tag>'
		]);
		expect((await formatter.variables(3)).map((field) => field.name)).toEqual(['error']);
		expect(await formatter.variables(4)).toEqual([]);
		expect((await formatter.variables(6)).map((field) => field.name)).toEqual(['error']);
	});

	it('does not retain a null layout when the same native pointer handle becomes nonnull', async () => {
		const pointer = variable('pointer', '0x00000000', '?*i32', 2);
		const { formatter } = fixture([pointer], { 2: [variable('*pointer', '7')] });
		expect((await formatter.variables(1))[0]).toMatchObject({
			value: 'null',
			variablesReference: 0
		});
		formatter.invalidateValues();
		pointer.value = '0x100';
		expect((await formatter.variables(1))[0]).toMatchObject({
			value: 'some(0x100)',
			variablesReference: 2
		});
		expect(await formatter.variables(2)).toEqual([variable('*pointer', '7')]);
	});

	it('leaves ordinary structs, unavailable values, and unfamiliar layouts untouched', async () => {
		const locals = [
			composite('record', 'Record', 2),
			variable('missing', '<optimized out>', '?i32', 3),
			composite('future', '?i32', 4)
		];
		const { backend, formatter } = fixture(locals, {
			4: [...optionalFields("'\\x01'"), variable('extra', '8')]
		});
		expect(await formatter.variables(1)).toEqual(locals);
		expect(backend.variables.mock.calls.map(([reference]) => reference)).toEqual([1, 4]);
	});

	it('drops a pending native child or memory response when the stop changes', async () => {
		const { backend, formatter } = fixture([composite('bytes', '[]u8', 2)], {
			2: sliceFields('0x100', '4')
		});
		let release!: (value: Awaited<ReturnType<typeof backend.readMemory>>) => void;
		backend.readMemory.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const pending = formatter.variables(1);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		formatter.invalidate();
		release({ address: '0x100', data: Uint8Array.of(65, 66, 67, 68), unreadableBytes: 0 });
		expect(await pending).toEqual([]);
		expect((await formatter.variables(2)).map((field) => field.name)).toEqual(['ptr', 'len']);
	});

	it('bounds formatter work and rejects invalid paging arguments', async () => {
		const locals = Array.from({ length: 300 }, (_, index) =>
			composite(`v${index}`, '?i32', index + 2)
		);
		const fields = Object.fromEntries(
			locals.map((value) => [value.variablesReference!, optionalFields("'\\x01'")])
		);
		const { backend, formatter } = fixture(locals, fields);
		expect(await formatter.variables(1)).toHaveLength(300);
		expect(backend.variables).toHaveBeenCalledTimes(65);
		expect((await formatter.variables(1))[64].value).toBe('?i32');
		await expect(formatter.variables(2, -1)).rejects.toThrow(RangeError);
		await expect(formatter.variables(2, 0, NaN)).rejects.toThrow(RangeError);
	});
});
