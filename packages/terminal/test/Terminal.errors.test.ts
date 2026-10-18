import type { ITerminalOptions, Terminal as XtermTerminal } from '@xterm/xterm';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';
import TerminalHarness from './TerminalHarness.svelte';

const renderer = vi.hoisted(() => ({
	terminals: [] as XtermTerminal[],
	writes: [] as string[]
}));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
);

vi.mock('@xterm/xterm', async (importOriginal) => {
	// The parser works without canvas; xterm probes for one while importing its renderer.
	const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	const actual = await importOriginal<typeof import('@xterm/xterm')>().finally(() =>
		getContext.mockRestore()
	);
	return {
		...actual,
		// Keep the real parser and buffer; only skip the DOM renderer in jsdom.
		Terminal: class extends actual.Terminal {
			constructor(options: ITerminalOptions) {
				super({ ...options, cols: 120, rows: 10 });
				renderer.terminals.push(this);
			}
			open() {}
			focus() {}
			write(data: string | Uint8Array, callback?: () => void) {
				if (typeof data === 'string') renderer.writes.push(data);
				super.write(data, callback);
			}
		}
	};
});

vi.mock('../src/plugin/index.js', () => ({
	registerBasicPlugins: vi.fn(async () => ({})),
	loadWebglPlugin: vi.fn(async () => undefined)
}));

const mounted: Array<ReturnType<typeof mount>> = [];

afterEach(async () => {
	for (const component of mounted.splice(0)) await unmount(component);
	renderer.terminals.length = 0;
	renderer.writes.length = 0;
	document.body.replaceChildren();
});

async function mountTerminal(error: unknown) {
	let ready!: (terminal: TerminalControl) => void;
	const loaded = new Promise<TerminalControl>((resolve) => (ready = resolve));
	const sandbox = {
		clear: vi.fn(async () => {}),
		load: vi.fn(async () => {}),
		run: vi.fn(async () => {
			throw error;
		}),
		elapse: 1
	} as unknown as BoundSandbox;
	const component = mount(TerminalHarness, {
		target: document.body,
		props: {
			playground: {
				runtimeAssets: {},
				load: vi.fn(async () => sandbox)
			} as unknown as PlaygroundBinding,
			onReady: ready
		}
	});
	mounted.push(component);
	flushSync();
	return await loaded;
}

async function renderedRows() {
	const term = renderer.terminals[0];
	await new Promise<void>((resolve) => term.write('', resolve));
	const rows = [];
	for (let row = 0; row < term.buffer.active.length; row += 1) {
		const line = term.buffer.active.getLine(row)!;
		const text = line.translateToString(true);
		if (!text) continue;
		let column = 0;
		while (column < term.cols && !line.getCell(column)?.getChars().trim()) column += 1;
		rows.push({ text, column });
	}
	return rows;
}

describe('Terminal execution error rendering', () => {
	it('aligns multiline compiler errors at column zero and preserves diagnostic indentation', async () => {
		const error =
			'Main.java:3: error: one\n  detail: missing semicolon\nMain.java:4: error: two';
		const terminal = await mountTerminal(error);

		await expect(terminal.run('JAVA', '')).resolves.toBe(false);

		expect(await renderedRows()).toEqual([
			{ text: 'Main.java:3: error: one', column: 0 },
			{ text: '  detail: missing semicolon', column: 2 },
			{ text: 'Main.java:4: error: two', column: 0 }
		]);
		expect(terminal.getExecutionError?.()).toBe(error);
	});

	it('preserves existing CRLF and carriage-return control characters while normalizing bare LF', async () => {
		const error = 'first\r\nsecond\nold\rnew';
		const terminal = await mountTerminal(error);

		await expect(terminal.run('JAVA', '')).resolves.toBe(false);

		expect(renderer.writes).toContain('\r\n\x1B[1;3;31mfirst\r\nsecond\r\nold\rnew\u001B[?25l');
		expect(await renderedRows()).toEqual([
			{ text: 'first', column: 0 },
			{ text: 'second', column: 0 },
			{ text: 'new', column: 0 }
		]);
	});

	it('aligns multiline timeout errors while preserving their rejection', async () => {
		const error = Object.assign(new Error('execution timed out\ntry a shorter input'), {
			name: 'TimeoutError'
		});
		const terminal = await mountTerminal(error);

		await expect(terminal.run('JAVA', '')).rejects.toBe(error);

		expect(await renderedRows()).toEqual([
			{ text: 'TimeoutError: execution timed out', column: 0 },
			{ text: 'try a shorter input', column: 0 }
		]);
		expect(terminal.getExecutionError?.()).toBe(error);
	});
});
