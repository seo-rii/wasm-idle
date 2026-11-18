import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';
import TerminalHarness from './TerminalHarness.svelte';

const renderer = vi.hoisted(() => ({ term: undefined as XtermTerminal | undefined }));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
);
vi.mock('@xterm/xterm', async (importOriginal) => {
	const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	const actual = await importOriginal<typeof import('@xterm/xterm')>().finally(() =>
		getContext.mockRestore()
	);
	return {
		...actual,
		Terminal: class extends actual.Terminal {
			// Keep the real input events, VT parser, and screen buffer in jsdom.
			open() {
				renderer.term = this;
			}
			focus() {}
		}
	};
});
vi.mock('../src/plugin/index.js', () => ({
	registerBasicPlugins: vi.fn(async (term: XtermTerminal) => {
		const { Unicode11Addon } = await import('@xterm/addon-unicode11');
		term.loadAddon(new Unicode11Addon());
		term.unicode.activeVersion = '11';
		return {};
	}),
	loadWebglPlugin: vi.fn()
}));

let component: ReturnType<typeof mount>;
let endRun: () => void;
afterEach(async () => {
	endRun?.();
	if (component) await unmount(component);
	document.body.replaceChildren();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

async function runningTerminal() {
	const started = deferred<void>();
	const completed = deferred<boolean>();
	const loaded = deferred<TerminalControl>();
	endRun = () => completed.resolve(true);
	const write = vi.fn<(text: string) => void>();
	const sandbox = {
		clear: async () => {},
		load: async () => {},
		run: async (_code: string, prepare: boolean) => {
			if (prepare) return true;
			started.resolve();
			return completed.promise;
		},
		write,
		elapse: 0
	} as unknown as BoundSandbox;
	component = mount(TerminalHarness, {
		target: document.body,
		props: {
			playground: {
				runtimeAssets: {},
				load: async () => sandbox
			} as unknown as PlaygroundBinding,
			onReady: loaded.resolve
		}
	});
	flushSync();
	const control = await loaded.promise;
	void control.run('CPP', '');
	await started.promise;
	return { term: renderer.term!, sandbox, write };
}

it('edits foreground stdin with navigation and Delete and consumes unsupported key sequences', async () => {
	const { term, write } = await runningTerminal();

	term.input('abc\x1b[HX\r');
	term.input('abc\x1b[D\x1b[3~\r');
	term.input('abc\x1b[D\x1b[FY\r');
	term.input('xy\x1bOH!\x1bOF?\r');
	term.input('abc\x1b[2~\x1b[5~\x1b[21~\x1bOP\x1b[A\x1b[B\r');
	term.input('abc\x1b[D\x7f\r');

	expect(write.mock.calls.flat()).toEqual([
		'Xabc\n',
		'ab\n',
		'abcY\n',
		'!xy?\n',
		'abc\n',
		'ac\n'
	]);
});

async function screen(term: XtermTerminal) {
	await new Promise<void>((resolve) => term.write('', resolve));
	const buffer = term.buffer.active;
	const rows = Array.from({ length: buffer.length }, (_, row) =>
		buffer.getLine(row)!.translateToString(true)
	);
	return { rows, row: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
}

it('keeps the visual cursor, wrapped text, and submitted line together after editing', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(8, 6);
	sandbox.output!('> ');
	term.input('abcdefghijk');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcdef', 'ghijk', '', '', '', ''],
		row: 1,
		col: 5
	});

	term.input('\x1b[D'.repeat(6));
	expect(await screen(term)).toMatchObject({ row: 0, col: 7 });
	term.input('X');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcdeX', 'fghijk', '', '', '', ''],
		row: 1,
		col: 0
	});
	term.input('\x7f\x1b[3~');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcdeg', 'hijk', '', '', '', ''],
		row: 0,
		col: 7
	});
	term.input('\x1b[H\r');
	expect(write).toHaveBeenCalledWith('abcdeghijk\n');
	expect(await screen(term)).toMatchObject({ row: 2, col: 0 });
});

it('handles delayed wrapping and wide characters at the right margin', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(8, 6);
	sandbox.output!('> ');
	term.input('abcde한글');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcde', '한글', '', '', '', ''],
		row: 1,
		col: 4
	});
	term.input('\x1b[D\x1b[D');
	term.input('X');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcdeX', '한글', '', '', '', ''],
		row: 1,
		col: 0
	});
	term.input('\x1b[3~\x1b[F\x7f');
	expect(await screen(term)).toMatchObject({ rows: ['> abcdeX', '', '', '', '', ''] });
	term.input('!\r');
	expect(write).toHaveBeenCalledWith('abcdeX!\n');
	expect(await screen(term)).toMatchObject({
		rows: ['> abcdeX', '!', '', '', '', ''],
		row: 2,
		col: 0
	});
});

it('moves over a grapheme whose xterm cells span two rows', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(8, 5);
	sandbox.output!('> ');
	const emoji = '😀\u200d😀';
	term.input('abcd' + emoji + 'z');
	term.input('\x1b[D\x1b[D');
	expect(await screen(term)).toMatchObject({ row: 0, col: 6 });
	term.input('\x1b[3~\r');
	expect(write).toHaveBeenCalledWith('abcdz\n');
	expect((await screen(term)).rows).toEqual(['> abcdz', '', '', '', '']);
});

it('edits pasted tabs at active VT tab stops and submits the original bytes', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(16, 5);
	sandbox.output!('> ');
	term.input('abc\tb');
	term.input('\x1b[D');
	expect(await screen(term)).toMatchObject({ row: 0, col: 8 });
	term.input('\x1b[H\x1b[3~');
	expect((await screen(term)).rows[0]).toBe('> bc    b');
	term.input('\x1b[F\x1b[DZ\r');
	expect(write).toHaveBeenCalledWith('bc\tZb\n');
	expect((await screen(term)).rows[0]).toBe('> bc    Zb');

	// Set a custom tab stop at column six, as a foreground program can.
	sandbox.output!('\x1b[3g\x1b[6G\x1bH\r> ');
	term.input('a\tb\x1b[D');
	expect(await screen(term)).toMatchObject({ row: 1, col: 5 });
	term.input('X\r');
	expect(write).toHaveBeenCalledWith('a\tXb\n');
	expect((await screen(term)).rows[1]).toBe('> a  Xb');
});
