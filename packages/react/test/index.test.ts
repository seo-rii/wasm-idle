import {
	DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
	createPlaygroundBinding,
	type PlaygroundBinding,
	type PlaygroundBindingOptions,
	type Sandbox,
	type SandboxLoader,
	type SandboxRuntimeAssets
} from '@wasm-idle/core';
import { Activity, StrictMode, act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWasmIdleHost, useWasmIdlePlayground, type ReactWasmIdleHost } from '../src/index.js';

vi.mock('@wasm-idle/core', async (importOriginal) => {
	const core = await importOriginal<typeof import('@wasm-idle/core')>();
	return {
		...core,
		createPlaygroundBinding: vi.fn(
			(...args: Parameters<typeof core.createPlaygroundBinding>) => {
				const binding = core.createPlaygroundBinding(...args);
				binding.dispose = vi.fn(binding.dispose);
				return binding;
			}
		)
	};
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createSandboxLoader(terminate: () => void = vi.fn()) {
	const loadSandbox: SandboxLoader = vi.fn(
		async () =>
			({
				constructor: Object,
				eof: vi.fn(),
				load: vi.fn(async () => undefined),
				run: vi.fn(async () => true),
				terminate,
				clear: vi.fn(async () => undefined)
			}) satisfies Sandbox
	);
	return { terminate, loadSandbox };
}

function Playground(props: {
	runtimeAssets: SandboxRuntimeAssets;
	loadSandbox: SandboxLoader;
	options?: PlaygroundBindingOptions;
	rendered: PlaygroundBinding[];
}) {
	props.rendered.push(
		useWasmIdlePlayground(props.runtimeAssets, props.loadSandbox, props.options)
	);
	return null;
}

function Host(props: {
	loadSandbox: SandboxLoader;
	options?: PlaygroundBindingOptions;
	rendered: ReactWasmIdleHost[];
}) {
	props.rendered.push(useWasmIdleHost('/runtime', props.loadSandbox, props.options));
	return null;
}

let root: Root;

async function renderStrict(node: ReactNode) {
	await act(async () => root.render(createElement(StrictMode, null, node)));
}

beforeEach(() => {
	root = createRoot(document.createElement('div'));
});

afterEach(async () => {
	await act(async () => root.unmount());
	vi.mocked(createPlaygroundBinding).mockClear();
});

describe('useWasmIdlePlayground', () => {
	it('keeps a live binding after StrictMode replays its mount effects', async () => {
		const { terminate, loadSandbox } = createSandboxLoader();
		const rendered: PlaygroundBinding[] = [];

		await renderStrict(
			createElement(Playground, { runtimeAssets: '/runtime', loadSandbox, rendered })
		);
		const binding = rendered.at(-1)!;

		expect(binding.dispose).not.toHaveBeenCalled();
		await binding.load('C');

		await act(async () => root.unmount());

		await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
		expect(binding.dispose).toHaveBeenCalledTimes(1);
	});

	it('never hands a disposed binding to effects replayed by StrictMode', async () => {
		const { loadSandbox } = createSandboxLoader();
		const loads: Promise<unknown>[] = [];
		function Consumer() {
			const binding = useWasmIdlePlayground('/runtime', loadSandbox);
			useEffect(() => {
				loads.push(binding.load('C'));
			}, [binding]);
			return null;
		}

		await renderStrict(createElement(Consumer));

		expect(loads.length).toBeGreaterThan(1);
		await expect(Promise.all(loads)).resolves.toHaveLength(loads.length);
	});

	it('replaces the binding when its identity changes and disposes the old one once', async () => {
		const { terminate, loadSandbox } = createSandboxLoader();
		const rendered: PlaygroundBinding[] = [];
		const renderPlayground = (runtimeAssets: SandboxRuntimeAssets) =>
			renderStrict(
				createElement(Playground, {
					runtimeAssets,
					loadSandbox,
					options: { prewarm: false },
					rendered
				})
			);

		await renderPlayground('/runtime-a');
		const first = rendered.at(-1)!;
		await first.load('C');
		await renderPlayground('/runtime-a');

		expect(rendered.at(-1)).toBe(first);

		await renderPlayground('/runtime-b');
		const second = rendered.at(-1)!;

		expect(second).not.toBe(first);
		await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
		expect(first.dispose).toHaveBeenCalledTimes(1);
		expect(second.dispose).not.toHaveBeenCalled();
		expect(createPlaygroundBinding).toHaveBeenLastCalledWith('/runtime-b', loadSandbox, {
			prewarm: false
		});
		await second.load('C');
	});

	it('recreates a binding that was released while hidden by Activity', async () => {
		const { loadSandbox } = createSandboxLoader();
		const rendered: PlaygroundBinding[] = [];
		const renderPlayground = (mode: 'hidden' | 'visible') =>
			renderStrict(
				createElement(Activity, {
					mode,
					children: createElement(Playground, {
						runtimeAssets: '/runtime',
						loadSandbox,
						rendered
					})
				})
			);

		await renderPlayground('visible');
		const first = rendered.at(-1)!;
		await renderPlayground('hidden');
		await vi.waitFor(() => expect(first.dispose).toHaveBeenCalledTimes(1));
		await renderPlayground('visible');
		const second = rendered.at(-1)!;

		expect(second).not.toBe(first);
		expect(first.dispose).toHaveBeenCalledTimes(1);
		expect(second.dispose).not.toHaveBeenCalled();
		await second.load('C');
	});
});

describe('useWasmIdleHost', () => {
	it('passes binding options through to the core binding', async () => {
		const { loadSandbox } = createSandboxLoader();
		const rendered: ReactWasmIdleHost[] = [];
		const options = { trustProfile: DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE };

		await renderStrict(createElement(Host, { loadSandbox, options, rendered }));
		const host = rendered.at(-1)!;

		expect(createPlaygroundBinding).toHaveBeenLastCalledWith('/runtime', loadSandbox, options);
		expect(host.binding.trustProfile?.profileId).toBe(
			DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE.profileId
		);
		expect(host.terminalProps.trustProfile).toBe(host.binding.trustProfile);
		expect(host.binding.dispose).not.toHaveBeenCalled();
	});

	it('still disposes the binding when terminal destruction fails', async () => {
		const { terminate, loadSandbox } = createSandboxLoader();
		const terminalError = new Error('terminal destroy failed');
		const destroy = vi.fn(async () => {
			throw terminalError;
		});
		const rendered: ReactWasmIdleHost[] = [];
		await renderStrict(createElement(Host, { loadSandbox, rendered }));
		await act(async () => rendered.at(-1)!.setTerminal({ destroy } as never));
		const host = rendered.at(-1)!;
		await host.binding.load('C');

		await act(async () => {
			await expect(host.dispose()).rejects.toBe(terminalError);
		});

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(host.binding.dispose).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(rendered.at(-1)!.terminal).toBeUndefined();
	});

	it('reports terminal and binding cleanup failures together', async () => {
		const terminalError = new Error('terminal destroy failed');
		const bindingError = new Error('binding cleanup failed');
		const { loadSandbox } = createSandboxLoader(() => {
			throw bindingError;
		});
		const rendered: ReactWasmIdleHost[] = [];
		await renderStrict(createElement(Host, { loadSandbox, rendered }));
		await act(async () =>
			rendered.at(-1)!.setTerminal({
				destroy: async () => {
					throw terminalError;
				}
			} as never)
		);
		const host = rendered.at(-1)!;
		await host.binding.load('C');

		let failure: unknown;
		await act(async () => {
			failure = await host.dispose().catch((error: unknown) => error);
		});

		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toEqual([terminalError, bindingError]);
	});
});
