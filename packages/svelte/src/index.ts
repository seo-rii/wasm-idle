import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type PlaygroundBindingOptions,
	type SandboxLoader,
	type SandboxRuntimeAssets,
	type TerminalControl
} from '@wasm-idle/core';
import { writable, type Writable } from 'svelte/store';

export interface SvelteWasmIdleHost {
	binding: PlaygroundBinding;
	terminal: Writable<TerminalControl | undefined>;
	terminalProps: PlaygroundBinding['terminalProps'];
	setTerminal: (terminal: TerminalControl | undefined) => void;
	dispose: () => Promise<void>;
}

export interface SvelteWasmIdleHostOptions extends PlaygroundBindingOptions {
	registerDispose?: (cleanup: () => void) => void;
}

export function createSvelteWasmIdleHost(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options: SvelteWasmIdleHostOptions = {}
): SvelteWasmIdleHost {
	const { registerDispose, ...bindingOptions } = options;
	const binding = createPlaygroundBinding(runtimeAssets, loadSandbox, bindingOptions);
	const terminal = writable<TerminalControl | undefined>(undefined);
	let currentTerminal: TerminalControl | undefined;
	const dispose = async () => {
		const terminalToDispose = currentTerminal;
		currentTerminal = undefined;
		terminal.set(undefined);
		const failures: unknown[] = [];
		try {
			if (terminalToDispose) await terminalToDispose.destroy();
		} catch (error) {
			failures.push(error);
		}
		try {
			await binding.dispose();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Failed to dispose the Svelte wasm-idle host');
		}
	};
	const host: SvelteWasmIdleHost = {
		binding,
		terminal,
		terminalProps: binding.terminalProps,
		setTerminal(nextTerminal) {
			currentTerminal = nextTerminal;
			terminal.set(nextTerminal);
		},
		dispose
	};
	registerDispose?.(() => {
		void dispose().catch(() => {});
	});
	return host;
}

export function createSveltePlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options?: PlaygroundBindingOptions
): PlaygroundBinding {
	return createPlaygroundBinding(runtimeAssets, loadSandbox, options);
}
export type {
	PlaygroundBinding,
	PlaygroundBindingOptions,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
