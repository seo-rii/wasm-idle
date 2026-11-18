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
	registerBasicPlugins: vi.fn(async () => ({})),
	loadWebglPlugin: vi.fn()
}));

let component: ReturnType<typeof mount>;
let endRun: () => void;
afterEach(async () => {
	endRun?.();
	if (component) await unmount(component);
	document.body.replaceChildren();
});

async function runningTerminal() {
	const started = Promise.withResolvers<void>();
	const completed = Promise.withResolvers<boolean>();
	const loaded = Promise.withResolvers<TerminalControl>();
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
