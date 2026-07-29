import {
	createPlaygroundBinding,
	type PlaygroundBinding,
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

export interface SvelteWasmIdleHostOptions {
	registerDispose?: (cleanup: () => void) => void;
}

export function createSvelteWasmIdleHost(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options: SvelteWasmIdleHostOptions = {}
): SvelteWasmIdleHost {
	const binding = createPlaygroundBinding(runtimeAssets, loadSandbox);
	const terminal = writable<TerminalControl | undefined>(undefined);
	let currentTerminal: TerminalControl | undefined;
	const dispose = async () => {
		const terminalToDispose = currentTerminal;
		currentTerminal = undefined;
		terminal.set(undefined);
		if (terminalToDispose) await terminalToDispose.destroy();
		await binding.dispose();
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
	options.registerDispose?.(() => {
		void dispose().catch(() => {});
	});
	return host;
}

export function createSveltePlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): PlaygroundBinding {
	return createPlaygroundBinding(runtimeAssets, loadSandbox);
}
export type {
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
