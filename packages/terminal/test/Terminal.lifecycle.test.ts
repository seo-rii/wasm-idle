import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';
import TerminalHarness from './TerminalHarness.svelte';

vi.stubGlobal(
	'ResizeObserver',
	class {
		disconnect() {}
		observe() {}
		unobserve() {}
	}
);

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		options: Record<string, unknown>;

		constructor(options: Record<string, unknown>) {
			this.options = { ...options };
		}

		dispose() {}
		focus() {}
		getSelection() {
			return '';
		}
		hasSelection() {
			return false;
		}
		onData() {}
		onKey() {}
		open() {}
		reset() {}
		write() {}
	}
}));

vi.mock('../src/plugin/index.js', () => ({
	default: vi.fn(async () => ({ fit: { fit: vi.fn() } }))
}));

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function createSandbox(run: BoundSandbox['run'] = vi.fn(async () => true)): BoundSandbox {
	return {
		clear: vi.fn(async () => undefined),
		eof: vi.fn(),
		kill: vi.fn(async () => undefined),
		load: vi.fn(async () => undefined),
		run: vi.fn(run),
		write: vi.fn(),
		elapse: 0
	} as unknown as BoundSandbox;
}

const mountedComponents: Array<ReturnType<typeof mount>> = [];

async function mountTerminal(playground: PlaygroundBinding) {
	let resolveTerminal!: (terminal: TerminalControl) => void;
	const ready = new Promise<TerminalControl>((resolve) => {
		resolveTerminal = resolve;
	});
	const component = mount(TerminalHarness, {
		target: document.body,
		props: { playground, onReady: resolveTerminal }
	});
	mountedComponents.push(component);
	flushSync();
	return await ready;
}

afterEach(async () => {
	for (const component of mountedComponents.splice(0)) await unmount(component);
	document.body.replaceChildren();
});

describe('Terminal sandbox input generations', () => {
	it.each(['stop', 'clear', 'replace'] as const)(
		'discards prepare-time input before a sandbox is retired by %s',
		async (boundary) => {
			const prepared = deferred<boolean | string>();
			const firstSandbox = createSandbox((_code, prepare) =>
				prepare ? prepared.promise : Promise.resolve(true)
			);
			const secondSandbox = createSandbox();
			const playground: PlaygroundBinding = {
				runtimeAssets: {} as PlaygroundBinding['runtimeAssets'],
				load: vi.fn(async (language) =>
					language === 'FIRST' ? firstSandbox : secondSandbox
				)
			};
			const terminal = await mountTerminal(playground);

			const preparing = terminal.prepare('FIRST', 'source');
			await vi.waitFor(() => expect(firstSandbox.run).toHaveBeenCalledOnce());
			await terminal.write('stale\n');
			if (boundary === 'stop') await terminal.stop!();
			if (boundary === 'clear') await terminal.clear();
			prepared.resolve(true);
			await preparing;
			await terminal.run('SECOND', 'source');

			expect(secondSandbox.write).not.toHaveBeenCalledWith('stale\n');
		}
	);

	it('preserves prepare-time input for the run in the same sandbox generation', async () => {
		const prepared = deferred<boolean | string>();
		const sandbox = createSandbox((_code, prepare) =>
			prepare ? prepared.promise : Promise.resolve(true)
		);
		const playground: PlaygroundBinding = {
			runtimeAssets: {} as PlaygroundBinding['runtimeAssets'],
			load: vi.fn(async () => sandbox)
		};
		const terminal = await mountTerminal(playground);

		const preparing = terminal.prepare('C', 'source');
		await vi.waitFor(() => expect(sandbox.run).toHaveBeenCalledOnce());
		await terminal.write('kept\n');
		prepared.resolve(true);
		await preparing;
		await terminal.run('C', 'source');

		expect(playground.load).toHaveBeenCalledOnce();
		expect(sandbox.write).toHaveBeenCalledWith('kept\n');
		expect(vi.mocked(sandbox.write!).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(sandbox.run).mock.invocationCallOrder[1]!
		);
	});
});
