import { expect, it } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { createReadlineOutput } from '../src/readline-output.js';

it('positions a native resize after queued echo using the live prompt marker', () => {
	let osc!: (payload: string) => boolean;
	let flush!: () => void;
	let shellOwnsDisplay = true;
	const writes: string[] = [];
	const marker = { line: 7, isDisposed: false, dispose() {} };
	const terminal = {
		rows: 24,
		modes: { bracketedPasteMode: true },
		buffer: { active: { type: 'normal', baseY: 4 } },
		registerMarker: () => marker,
		parser: {
			registerOscHandler(_id: number, fn: typeof osc) {
				osc = fn;
				return { dispose() {} };
			}
		},
		write(data: string, callback?: () => void) {
			if (callback) flush = callback;
			if (data) writes.push(data);
		}
	} as unknown as Terminal;
	const output = createReadlineOutput(
		terminal,
		(text) => writes.push(text),
		() => shellOwnsDisplay
	);
	osc('P');
	output.write('queued\x1b]');
	output.write('6973;R1\x07native');
	output.write(' redraw');
	marker.line++; // Reflow occurred before the queued echo was parsed.
	expect(writes).toEqual(['queued']);
	flush();
	expect(writes).toEqual(['queued', '\x1b[6;1H', 'native redraw']);
	shellOwnsDisplay = false;
	output.write('\x1b]6973;R1\x07foreground');
	flush();
	expect(writes.at(-1)).toBe('foreground');
	expect(writes.filter((value) => value.includes('H'))).toHaveLength(1);
	output.write('ordinary\x1b[31moutput');
	expect(writes.at(-1)).toBe('ordinary\x1b[31moutput');
	output.dispose();
});
