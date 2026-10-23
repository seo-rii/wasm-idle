import { expect, it } from 'vitest';
import { inspectMonoDebuggerExports } from '../scripts/inspect-debugger-exports.mjs';

const text = (value: string) => [value.length, ...new TextEncoder().encode(value)];
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
const moduleWithBody = (body: number[]) =>
	new Uint8Array([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, [1, 0x60, 0, 1, 0x7f]),
		...section(2, [1, ...text('env'), ...text('host'), 0, 0]),
		...section(3, [1, 0]),
		...section(7, [1, ...text('mono_wasm_send_dbg_command'), 0, 1]),
		...section(10, [1, body.length, ...body])
	]);

it('finds a real constant-false native stub after imported functions', async () => {
	const bytes = moduleWithBody([0, 0x41, 0, 0x0b]);
	const { instance } = await WebAssembly.instantiate(bytes, { env: { host: () => 42 } });
	expect((instance.exports.mono_wasm_send_dbg_command as () => number)()).toBe(0);
	expect(inspectMonoDebuggerExports(bytes)).toEqual([
		expect.objectContaining({
			functionIndex: 1,
			kind: 'constant-false-stub',
			bodyHex: '0041000b'
		})
	]);
});

it('does not call an arbitrary native function a working debugger', () => {
	expect(inspectMonoDebuggerExports(moduleWithBody([0, 0x10, 0, 0x0b]))[0].kind).toBe(
		'unqualified-function'
	);
});

it('fails closed on a truncated artifact', () => {
	const bytes = moduleWithBody([0, 0x41, 0, 0x0b]);
	expect(() => inspectMonoDebuggerExports(bytes.subarray(0, bytes.length - 1))).toThrow(
		'Truncated'
	);
});
