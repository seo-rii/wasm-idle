import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoundSandbox, PlaygroundBinding, TerminalControl } from '../src/types.js';
import { loadWebglPlugin } from '../src/plugin/index.js';
import Terminal from '../src/Terminal.svelte';
import TerminalHarness from './TerminalHarness.svelte';

const xtermCallbacks = vi.hoisted(() => ({
	filterKey: undefined as ((event: KeyboardEvent) => boolean) | undefined,
	onData: undefined as ((text: string) => void) | undefined
}));

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
		onData(callback: (text: string) => void) {
			xtermCallbacks.onData = callback;
		}
		attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) {
			xtermCallbacks.filterKey = callback;
		}
		onKey() {}
		open() {}
		reset() {}
		write() {}
	}
}));

vi.mock('../src/plugin/index.js', () => ({
	registerBasicPlugins: vi.fn(async () => ({ fit: { fit: vi.fn() } })),
	loadWebglPlugin: vi.fn(async () => undefined)
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
	xtermCallbacks.onData = undefined;
	xtermCallbacks.filterKey = undefined;
	document.body.replaceChildren();
});

describe('Terminal optional renderer readiness', () => {
	it('becomes ready without loading WebGL by default', async () => {
		vi.mocked(loadWebglPlugin).mockClear();
		const onload = vi.fn();
		const component = mount(Terminal, {
			target: document.body,
			props: { playground: {} as PlaygroundBinding, onload }
		});
		mountedComponents.push(component);
		await vi.waitFor(() => expect(onload).toHaveBeenCalledOnce());
		expect(loadWebglPlugin).not.toHaveBeenCalled();
	});

	it('signals readiness before an optional renderer loads or fails', async () => {
		let rejectRenderer!: (reason: Error) => void;
		vi.mocked(loadWebglPlugin).mockClear();
		vi.mocked(loadWebglPlugin).mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectRenderer = reject;
				})
		);
		const onload = vi.fn();
		const component = mount(Terminal, {
			target: document.body,
			props: { playground: {} as PlaygroundBinding, onload, webgl: true }
		});
		mountedComponents.push(component);
		await vi.waitFor(() => expect(loadWebglPlugin).toHaveBeenCalledOnce());
		expect(onload).toHaveBeenCalledOnce();
		expect(onload.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(loadWebglPlugin).mock.invocationCallOrder[0]
		);
		rejectRenderer(new Error('No GPU context'));
		await Promise.resolve();
		expect(onload).toHaveBeenCalledOnce();
	});
});

describe('Terminal sandbox input generations', () => {
	it.each(['stop', 'clear'] as const)(
		'does not cache a prepare whose sandbox load resumes after %s',
		async (boundary) => {
			const loaded = deferred<void>();
			const prepareCalls: boolean[] = [];
			const sandbox = createSandbox(async (_code, prepare) => {
				prepareCalls.push(prepare);
				return true;
			});
			sandbox.load = vi.fn(() => loaded.promise);
			const playground: PlaygroundBinding = {
				runtimeAssets: {} as PlaygroundBinding['runtimeAssets'],
				load: vi.fn(async () => sandbox)
			};
			const terminal = await mountTerminal(playground);

			const preparing = terminal.prepare('C', 'source');
			await vi.waitFor(() => expect(sandbox.load).toHaveBeenCalledOnce());
			if (boundary === 'stop') await terminal.stop!();
			else await terminal.clear();
			loaded.resolve(undefined);
			await preparing;
			await terminal.run('C', 'source');

			expect(prepareCalls).toEqual([true, true, false]);
		}
	);

	it.each(['stop', 'clear'] as const)(
		'does not restore a prepared execution after %s invalidates its pending prepare',
		async (boundary) => {
			const prepared = deferred<boolean | string>();
			const prepareCalls: boolean[] = [];
			const sandbox = createSandbox((_code, prepare) => {
				prepareCalls.push(prepare);
				return prepare && prepareCalls.length === 1
					? prepared.promise
					: Promise.resolve(true);
			});
			const playground: PlaygroundBinding = {
				runtimeAssets: {} as PlaygroundBinding['runtimeAssets'],
				load: vi.fn(async () => sandbox)
			};
			const terminal = await mountTerminal(playground);

			const preparing = terminal.prepare('C', 'source');
			await vi.waitFor(() => expect(sandbox.run).toHaveBeenCalledOnce());
			if (boundary === 'stop') await terminal.stop!();
			else await terminal.clear();
			prepared.resolve(true);
			await preparing;
			await terminal.run('C', 'source');

			expect(prepareCalls).toEqual([true, true, false]);
		}
	);

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

	it.each([{ ctrlKey: true }, { metaKey: true }])(
		'leaves foreground paste to the browser and discards pasted input after stop (%j)',
		async (modifier) => {
			const prepared = deferred<boolean>();
			const sandbox = createSandbox((_code, prepare) =>
				prepare ? prepared.promise : Promise.resolve(true)
			);
			const terminal = await mountTerminal({
				runtimeAssets: {} as PlaygroundBinding['runtimeAssets'],
				load: vi.fn(async () => sandbox)
			});
			const preparing = terminal.prepare('C', 'source');
			await vi.waitFor(() => expect(sandbox.run).toHaveBeenCalledOnce());
			const key = new KeyboardEvent('keydown', { ...modifier, key: 'v', cancelable: true });
			expect(xtermCallbacks.filterKey?.(key)).toBe(false);
			expect(key.defaultPrevented).toBe(false);
			xtermCallbacks.onData?.('old input\r');
			await terminal.stop!();
			prepared.resolve(true);
			await preparing;
			await terminal.run('C', 'source');
			expect(sandbox.write).not.toHaveBeenCalled();
		}
	);
});

describe('Terminal structured debugger bridge', () => {
	it('preserves expandable metadata and snapshots breakpoint options across the bridge', async () => {
		const sandbox = createSandbox();
		const value = {
			result: 'size=2',
			type: 'std::vector<int>',
			variablesReference: 19,
			indexedVariables: 2
		};
		sandbox.debugEvaluateValue = vi.fn(async () => value);
		sandbox.setSourceBreakpoints = vi.fn(async () => undefined);
		const terminal = await mountTerminal({
			runtimeAssets: {},
			load: vi.fn(async () => sandbox)
		});
		await terminal.run('C', 'int main() {}', false);
		await expect(
			terminal.debugEvaluateValue!('values', { context: 'hover', frameId: 7 })
		).resolves.toEqual(value);
		expect(sandbox.debugEvaluateValue).toHaveBeenCalledWith('values', {
			context: 'hover',
			frameId: 7
		});
		const breakpoints = [{ line: 7, hitCondition: '3' }];
		const pending = terminal.setSourceBreakpoints!(breakpoints, '/workspace/main.cpp');
		breakpoints[0].hitCondition = '5';
		await pending;
		expect(sandbox.setSourceBreakpoints).toHaveBeenCalledWith(
			[{ line: 7, hitCondition: '3' }],
			'/workspace/main.cpp'
		);
	});

	it('keeps disabled initial locations off legacy lines and rejects advanced trace options', async () => {
		const sandbox = createSandbox();
		sandbox.setBreakpoints = vi.fn(async () => undefined);
		sandbox.debugEvaluate = vi.fn(async () => '42');
		const terminal = await mountTerminal({
			runtimeAssets: {},
			load: vi.fn(async () => sandbox)
		});
		await terminal.run('C', 'int main() {}', false, undefined, [], {
			sourceBreakpoints: [
				{
					sourcePath: '/workspace/main.c',
					lines: [5, 7],
					breakpoints: [{ line: 5, enabled: false }, { line: 7 }]
				}
			]
		});
		expect(vi.mocked(sandbox.run).mock.calls.at(-1)?.[5]).toMatchObject({
			sourceBreakpoints: [{ lines: [7] }]
		});
		await expect(
			terminal.setSourceBreakpoints!([{ line: 7, hitCondition: '3' }])
		).rejects.toThrow('hitCondition');
		expect(sandbox.setBreakpoints).not.toHaveBeenCalled();
		await expect(terminal.debugEvaluateValue!('answer')).resolves.toEqual({
			result: '42',
			variablesReference: 0
		});
		await expect(terminal.debugEvaluateValue!('answer', { frameId: 42 })).resolves.toEqual({
			result: '?',
			variablesReference: 0
		});
	});
});
