import { fitAtInputOrigin } from '../src/input-line-layout.js';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';
import TerminalHarness from './TerminalHarness.svelte';

const renderer = vi.hoisted(() => ({
	term: undefined as XtermTerminal | undefined,
	columns: 0
}));
const sizeListeners = new Map<Element, () => void>();

vi.stubGlobal(
	'ResizeObserver',
	class {
		constructor(private callback: ResizeObserverCallback) {}
		observe(target: Element) {
			sizeListeners.set(target, () =>
				this.callback([{ target } as ResizeObserverEntry], this as ResizeObserver)
			);
		}
		unobserve(target: Element) {
			sizeListeners.delete(target);
		}
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
		return {
			fit: {
				proposeDimensions: () => ({ cols: renderer.columns || term.cols, rows: term.rows }),
				fit: () => term.resize(renderer.columns || term.cols, term.rows)
			}
		};
	}),
	loadWebglPlugin: vi.fn()
}));

let component: ReturnType<typeof mount>;
let endRun: () => void;
afterEach(async () => {
	renderer.columns = 0;
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
	const eof = vi.fn();
	const sandbox = {
		clear: async () => {},
		load: async () => {},
		run: async (_code: string, prepare: boolean) => {
			if (prepare) return true;
			started.resolve();
			return completed.promise;
		},
		write,
		eof,
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
	const run = control.run('CPP', '');
	await started.promise;
	return { term: renderer.term!, sandbox, write, eof, control, run };
}

it.each(['exit', 'stop'])(
	'discards the previous program draft before an idle EOF after %s',
	async (action) => {
		const { term, write, eof, control, run } = await runningTerminal();
		term.input('previous program');
		if (action === 'stop') {
			await control.stop!();
			await control.eof?.();
		}
		endRun();
		await run;
		if (action === 'exit') await control.eof?.();
		await control.run('CPP', 'another program');
		expect(write).not.toHaveBeenCalled();
		expect(eof).toHaveBeenCalledOnce();
	}
);

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

it('moves by word on Meta+B/F without inserting unsupported Meta keys', async () => {
	const { term, write } = await runningTerminal();
	term.input('one two\x1bbX\r');
	term.input('가나,do!\x1bb\x1bb_\x1bfX\r');
	term.input('\x1bb\x1bfleft\x1bx\r');
	expect(write.mock.calls.flat()).toEqual(['one Xtwo\n', '_가나X,do!\n', 'left\n']);
});

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

it('reanchors an edited Unicode draft after split VT output and keeps Enter aligned', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(18, 8);
	sandbox.output!('> ');
	term.input('ab한🙂cd\x1b[D\x1b[D');
	await screen(term);
	sandbox.output!('\n\x1b[3');
	await screen(term);
	sandbox.output!('1mstatus\ud83d');
	await screen(term);
	sandbox.output!('\ude42\x1b[0m\n');
	await vi.waitFor(async () =>
		expect((await screen(term)).rows.filter(Boolean)).toEqual(['> ', 'status🙂', 'ab한🙂cd'])
	);
	term.input('X\r');
	expect(write).toHaveBeenCalledWith('ab한🙂Xcd\n');
	await vi.waitFor(async () =>
		expect((await screen(term)).rows.filter(Boolean)).toEqual(['> ', 'status🙂', 'ab한🙂Xcd'])
	);
});

it('retains a wrapped prompt and restores its input origin on shrink and expansion', async () => {
	const { term, sandbox } = await runningTerminal();
	term.resize(16, 8);
	sandbox.output!('history\n\x1b[32mabcdefghijklmno한🙂: \x1b[0m');
	await screen(term);
	for (const cols of [8, 30]) {
		const column = fitAtInputOrigin(term, () => term.resize(cols, 8));
		const actual = await screen(term);
		expect(actual.col).toBe(column);
		expect(actual.rows.join('')).toBe('historyabcdefghijklmno한🙂: ');
	}
	term.input('X\r');
	expect((await screen(term)).rows.filter(Boolean)).toEqual([
		'history',
		'abcdefghijklmno한🙂: X'
	]);
});

it('leaves a full-width program prompt pending until the next output byte', async () => {
	const { term, sandbox, write } = await runningTerminal();
	term.resize(8, 7);
	sandbox.output!('history\n\x1b[31m12345678\x1b[0m');
	term.input('ab');
	await screen(term);
	sandbox.output!('\nnext\n');
	await vi.waitFor(async () =>
		expect((await screen(term)).rows.slice(0, 4)).toEqual(['history', '12345678', 'next', 'ab'])
	);
	term.input('\r');
	expect(write).toHaveBeenCalledWith('ab\n');
});

it.each([2, 90])(
	'keeps a scrolled draft and its caret %i characters from the end',
	async (trailing) => {
		const { term, sandbox, write } = await runningTerminal();
		term.resize(16, 5);
		const history = term.registerMarker();
		sandbox.output!('older history\n\x1b[32mprompt> \x1b[0m');
		const draft = '0123456789'.repeat(18);
		const caret = draft.length - trailing;
		term.input(draft + '\x1b[D'.repeat(trailing));
		await screen(term);
		sandbox.output!('\nPROGRESS\n');
		const prefix = 'older historyprompt> PROGRESS';
		const checkCaret = async () => {
			const { rows, row, col } = await screen(term);
			// A far-left caret keeps the rest of the line editable below the visible window.
			const content = rows.join('');
			expect((prefix + draft).startsWith(content)).toBe(true);
			if (trailing === 2) expect(content).toBe(prefix + draft);
			const before = term.buffer.active.getLine(row)!.translateToString(false, 0, col);
			expect(rows.slice(0, row).join('') + before).toBe(prefix + draft.slice(0, caret));
		};
		await vi.waitFor(checkCaret);
		for (const cols of [8, 32]) {
			renderer.columns = cols;
			for (const [element, notify] of sizeListeners) {
				Object.defineProperty(element, 'clientWidth', {
					configurable: true,
					value: cols * 10
				});
				notify();
			}
			flushSync();
			await vi.waitFor(async () => {
				expect(term.cols).toBe(cols);
				await checkCaret();
			});
		}
		term.input('X\r');
		const edited = draft.slice(0, caret) + 'X' + draft.slice(caret);
		expect(write).toHaveBeenCalledWith(edited + '\n');
		await vi.waitFor(async () =>
			expect((await screen(term)).rows.join('')).toBe(prefix + edited)
		);
		expect(history.isDisposed).toBe(false);
		expect(term.buffer.active.getLine(history.line)?.translateToString(true)).toBe(
			'older history'
		);
		history.dispose();
	}
);
