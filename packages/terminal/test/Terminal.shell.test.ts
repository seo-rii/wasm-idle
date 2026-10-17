import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	BoundSandbox,
	PlaygroundBinding,
	TerminalControl,
	TerminalShellBinding
} from '../src/types.js';
import TerminalHarness from './TerminalHarness.svelte';

const renderer = vi.hoisted(() => ({
	data: undefined as ((text: string) => void) | undefined,
	key: undefined as ((event: { key: string; domEvent: KeyboardEvent }) => void) | undefined,
	writes: [] as string[],
	disposals: 0
}));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
);
vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		options: Record<string, unknown> = {};
		constructor(options: Record<string, unknown>) {
			this.options = options;
		}
		open() {}
		focus() {}
		reset() {}
		dispose() {
			renderer.disposals += 1;
		}
		hasSelection() {
			return false;
		}
		getSelection() {
			return '';
		}
		write(text: string) {
			renderer.writes.push(text);
		}
		onData(callback: (text: string) => void) {
			renderer.data = callback;
		}
		onKey(callback: (event: { key: string; domEvent: KeyboardEvent }) => void) {
			renderer.key = callback;
		}
	}
}));
vi.mock('../src/plugin/index.js', () => ({
	registerBasicPlugins: vi.fn(async () => ({})),
	loadWebglPlugin: vi.fn(async () => undefined)
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function createShell(connected = Promise.resolve()) {
	let output: (text: string) => void = () => {};
	let error: ((reason: unknown) => void) | undefined;
	const binding = {
		connect: vi.fn(
			async (onOutput: (text: string) => void, onError?: (reason: unknown) => void) => {
				output = onOutput;
				error = onError;
				await connected;
			}
		),
		write: vi.fn(async (_text: string) => {}),
		eof: vi.fn(async () => {}),
		interrupt: vi.fn(async () => {}),
		dispose: vi.fn(async () => {})
	} satisfies TerminalShellBinding;
	return {
		binding,
		output: (text: string) => output(text),
		error: (reason: unknown) => error?.(reason)
	};
}

function createSandbox() {
	return {
		clear: vi.fn(async () => {}),
		load: vi.fn(async () => {}),
		run: vi.fn(async (_code: string, _prepare: boolean) => true),
		write: vi.fn(),
		eof: vi.fn(),
		kill: vi.fn(async () => {}),
		restart: vi.fn(async () => {}),
		elapse: 0
	} as unknown as BoundSandbox;
}

const mounted: Array<ReturnType<typeof mount>> = [];
async function mountTerminal(shell: TerminalShellBinding, sandbox = createSandbox()) {
	const ready = deferred<TerminalControl>();
	const playground = {
		load: vi.fn(async () => sandbox),
		runtimeAssets: {}
	} as unknown as PlaygroundBinding;
	const component = mount(TerminalHarness, {
		target: document.body,
		props: { playground, shell, onReady: ready.resolve }
	});
	mounted.push(component);
	flushSync();
	const terminal = await ready.promise;
	await vi.waitFor(() => expect(vi.mocked(shell.connect)).toHaveBeenCalledOnce());
	return { terminal, sandbox, playground, component };
}

afterEach(async () => {
	for (const component of mounted.splice(0)) await unmount(component);
	renderer.data = undefined;
	renderer.key = undefined;
	renderer.writes.length = 0;
	renderer.disposals = 0;
	document.body.replaceChildren();
});

describe('Terminal host shell binding', () => {
	it('renders shell output once and preserves CRLF across transport chunk boundaries', async () => {
		const shell = createShell();
		await mountTerminal(shell.binding);
		shell.output('hello\nexisting\r\npartial\r');
		shell.output('\n한글\0\n');
		flushSync();
		expect(renderer.writes.join('')).toBe('hello\r\nexisting\r\npartial\r\n한글\0\r\n');
		expect(document.querySelector('[data-testid="terminal-debug-output"]')?.textContent).toBe(
			renderer.writes.join('')
		);
		expect(shell.binding.connect).toHaveBeenCalledOnce();
	});

	it('sends idle keyboard text without local echo and maps Ctrl+C/D to shell controls once', async () => {
		const shell = createShell();
		await mountTerminal(shell.binding);
		renderer.data?.('printf hello\r');
		await vi.waitFor(() => expect(shell.binding.write).toHaveBeenCalledWith('printf hello\r'));
		renderer.key?.({
			key: '\u0003',
			domEvent: new KeyboardEvent('keydown', { ctrlKey: true, key: 'c' })
		});
		renderer.data?.('\u0003');
		renderer.key?.({
			key: '\u0004',
			domEvent: new KeyboardEvent('keydown', { ctrlKey: true, key: 'd' })
		});
		renderer.data?.('\u0004');
		await vi.waitFor(() => expect(shell.binding.eof).toHaveBeenCalledOnce());
		expect(shell.binding.interrupt).toHaveBeenCalledOnce();
		expect(shell.binding.write).toHaveBeenCalledOnce();
		expect(renderer.writes).toEqual([]);
	});

	it('keeps renderer readiness independent of connection while writes wait for the shell', async () => {
		const connected = deferred<void>();
		const shell = createShell(connected.promise);
		const { terminal } = await mountTerminal(shell.binding);
		const written = terminal.write('echo ready\n');
		await Promise.resolve();
		expect(shell.binding.write).not.toHaveBeenCalled();
		connected.resolve();
		await written;
		await terminal.eof?.();
		expect(shell.binding.write).toHaveBeenCalledWith('echo ready\n');
		expect(shell.binding.eof).toHaveBeenCalledOnce();
	});

	it('can interrupt a shell while its stdin write is blocked', async () => {
		const writing = deferred<void>();
		const shell = createShell();
		shell.binding.write.mockImplementation(() => writing.promise);
		const { terminal } = await mountTerminal(shell.binding);
		const written = terminal.write('pending input');
		await vi.waitFor(() => expect(shell.binding.write).toHaveBeenCalledOnce());
		renderer.data?.('\u0003');
		await vi.waitFor(() => expect(shell.binding.interrupt).toHaveBeenCalledOnce());
		writing.resolve();
		await written;
	});

	it('retains canonical stdin during prepare and run, then returns input to the shell', async () => {
		const prepared = deferred<boolean>();
		const shell = createShell();
		const sandbox = createSandbox();
		vi.mocked(sandbox.run).mockImplementation(async (_source, prepare) =>
			prepare ? await prepared.promise : true
		);
		const { terminal } = await mountTerminal(shell.binding, sandbox);
		const preparing = terminal.prepare('C', 'source');
		await terminal.write('program input\n');
		await terminal.eof?.();
		expect(shell.binding.write).not.toHaveBeenCalled();
		expect(shell.binding.eof).not.toHaveBeenCalled();
		prepared.resolve(true);
		await preparing;
		await terminal.run('C', 'source');
		expect(sandbox.write).toHaveBeenCalledWith('program input\n');
		expect(sandbox.eof).toHaveBeenCalledOnce();
		await terminal.write('echo shell\n');
		expect(shell.binding.write).toHaveBeenCalledWith('echo shell\n');
	});

	it('does not report shell output as Run readiness and preserves sandbox stop controls', async () => {
		const running = deferred<boolean>();
		const shell = createShell();
		const sandbox = createSandbox();
		vi.mocked(sandbox.run).mockImplementation(async (_source, prepare) =>
			prepare ? true : await running.promise
		);
		const { terminal } = await mountTerminal(shell.binding, sandbox);
		const report = vi.fn();
		const run = terminal.run('C', 'source', false, { report });
		await vi.waitFor(() => expect(sandbox.run).toHaveBeenCalledTimes(2));
		shell.output('background shell output\n');
		expect(report.mock.calls.some(([event]) => event.kind === 'ready')).toBe(false);
		renderer.key?.({
			key: '\u0003',
			domEvent: new KeyboardEvent('keydown', { ctrlKey: true, key: 'c' })
		});
		expect(sandbox.kill).toHaveBeenCalledOnce();
		expect(shell.binding.interrupt).not.toHaveBeenCalled();
		running.resolve(true);
		await run;
	});

	it('shows connection failures without preventing renderer readiness', async () => {
		const connected = deferred<void>();
		const shell = createShell(connected.promise);
		await mountTerminal(shell.binding);
		connected.reject(new Error('Browser storage unavailable'));
		await vi.waitFor(() =>
			expect(renderer.writes.join('')).toContain('Shell: Browser storage unavailable')
		);
	});

	it('preserves the shared shell through clear/restart and disposes it only once on teardown', async () => {
		const shell = createShell();
		const { terminal } = await mountTerminal(shell.binding);
		await terminal.run('PYTHON', 'source');
		await terminal.clear();
		await terminal.restartRuntime?.();
		expect(shell.binding.dispose).not.toHaveBeenCalled();
		await terminal.write('still alive\n');
		expect(shell.binding.write).toHaveBeenCalledWith('still alive\n');
		await Promise.all([terminal.destroy(), terminal.destroy()]);
		expect(shell.binding.dispose).toHaveBeenCalledOnce();
		expect(renderer.disposals).toBe(1);
		const outputCount = renderer.writes.length;
		shell.output('late worker response');
		expect(renderer.writes).toHaveLength(outputCount);
	});
});
