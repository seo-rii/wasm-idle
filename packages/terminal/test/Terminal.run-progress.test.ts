import type { ProgressLike, RuntimeProgressEvent } from '@wasm-idle/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalHarness from './TerminalHarness.svelte';
import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';

const { terminalWrites } = vi.hoisted(() => ({ terminalWrites: [] as string[] }));

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
		open() {}
		onData() {}
		onKey() {}
		write(text: string) {
			terminalWrites.push(text);
		}
		focus() {}
		reset() {}
		dispose() {}
		hasSelection() {
			return false;
		}
		getSelection() {
			return '';
		}
	}
}));

vi.mock('../src/plugin/index.js', () => ({
	default: vi.fn(async () => ({}))
}));

const mountedComponents: unknown[] = [];

afterEach(async () => {
	while (mountedComponents.length > 0) {
		await unmount(mountedComponents.pop() as never);
	}
	document.body.replaceChildren();
	terminalWrites.length = 0;
});

async function mountTerminal(sandbox: BoundSandbox) {
	let loaded: () => void = () => {};
	let terminalReady: (terminal: TerminalControl) => void = () => {};
	const ready = new Promise<void>((resolve) => {
		loaded = resolve;
	});
	const terminal = new Promise<TerminalControl>((resolve) => {
		terminalReady = resolve;
	});
	const component = mount(TerminalHarness, {
		target: document.body,
		props: {
			playground: {
				runtimeAssets: {},
				load: vi.fn(async () => sandbox)
			} as unknown as PlaygroundBinding,
			onload: loaded,
			onterminal: terminalReady
		}
	});
	mountedComponents.push(component);
	await Promise.all([ready, terminal]);
	flushSync();
	return await terminal;
}

function createSandbox(
	onRun: (context: {
		emitOutput: (text: string) => void;
		prepare: boolean;
	}) => boolean | Promise<boolean>
) {
	let output: ((text: string) => void) | undefined;
	const run = vi.fn(async (_code: string, prepare: boolean) => {
		return await onRun({
			emitOutput: (text) => output?.(text),
			prepare
		});
	});
	const sandbox = {
		clear: vi.fn(async () => {}),
		load: vi.fn(async () => {}),
		run,
		elapse: 1,
		set output(handler: ((text: string) => void) | undefined) {
			output = handler;
		},
		get output() {
			return output;
		}
	} as unknown as BoundSandbox;
	return { run, sandbox };
}

describe('Terminal direct-run progress', () => {
	it('does not treat compiler output as execution readiness', async () => {
		const events: RuntimeProgressEvent[] = [];
		const readinessAfterOutput: Array<{ prepare: boolean; readyCount: number }> = [];
		const { run, sandbox } = createSandbox(({ emitOutput, prepare }) => {
			emitOutput(prepare ? 'compiler output\n' : 'program output\n');
			readinessAfterOutput.push({
				prepare,
				readyCount: events.filter((event) => event.kind === 'ready').length
			});
			return true;
		});
		const terminal = await mountTerminal(sandbox);

		await terminal.run('RUST', 'fn main() {}', true, {
			report: (event) => events.push(event)
		});

		expect(run.mock.calls.map((call) => call[1])).toEqual([true, false]);
		expect(readinessAfterOutput).toEqual([
			{ prepare: true, readyCount: 0 },
			{ prepare: false, readyCount: 1 }
		]);
		expect(events.filter((event) => event.kind === 'ready')).toEqual([
			expect.objectContaining({ kind: 'ready', reason: 'stdout' })
		]);
	});

	it('reuses only a matching explicit preparation context', async () => {
		const { run, sandbox } = createSandbox(() => true);
		const terminal = await mountTerminal(sandbox);
		const args = ['one'];
		const options = { compileArgs: ['-O1'] };

		await terminal.prepare('RUST', 'fn main() {}', true, undefined, args, options);
		await terminal.run('RUST', 'fn main() {}', true, undefined, args, options);
		expect(run.mock.calls.map((call) => call[1])).toEqual([true, false]);

		await terminal.prepare('RUST', 'fn main() {}', true, undefined, args, options);
		await terminal.run('RUST', 'fn main() {}', true, undefined, args, {
			compileArgs: ['-O2']
		});
		expect(run.mock.calls.map((call) => call[1])).toEqual([true, false, true, true, false]);
	});

	it('settles a direct run as timed out before preserving the timeout error', async () => {
		const timeout = Object.assign(new Error('execution timed out'), {
			name: 'TimeoutError'
		});
		const { sandbox } = createSandbox(({ prepare }) => {
			if (!prepare) throw timeout;
			return true;
		});
		const terminal = await mountTerminal(sandbox);
		const events: RuntimeProgressEvent[] = [];

		await expect(
			terminal.run('RUST', 'fn main() {}', true, {
				report: (event) => events.push(event)
			})
		).rejects.toBe(timeout);
		expect(terminalWrites.join('')).toContain('execution timed out');
		expect(events).toContainEqual(
			expect.objectContaining({ kind: 'settled', outcome: 'timed-out' })
		);
	});
});
