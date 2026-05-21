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
}

export function createSvelteWasmIdleHost(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): SvelteWasmIdleHost {
	const binding = createPlaygroundBinding(runtimeAssets, loadSandbox);
	const terminal = writable<TerminalControl | undefined>(undefined);
	return {
		binding,
		terminal,
		terminalProps: binding.terminalProps,
		setTerminal(nextTerminal) {
			terminal.set(nextTerminal);
		}
	};
}

export const createSveltePlaygroundBinding = createSvelteWasmIdleHost;
export type {
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
