import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type SandboxLoader,
	type SandboxRuntimeAssets,
	type TerminalControl
} from '@wasm-idle/core';
import { computed, shallowRef, type Ref, type ShallowRef } from 'vue';

export type MaybeRef<T> = T | Ref<T>;

export interface VueWasmIdleHost {
	binding: Ref<PlaygroundBinding>;
	terminal: ShallowRef<TerminalControl | undefined>;
	terminalProps: Ref<PlaygroundBinding['terminalProps']>;
	setTerminal: (terminal: TerminalControl | undefined) => void;
}

function unwrap<T>(value: MaybeRef<T>): T {
	return typeof value === 'object' && value !== null && 'value' in value
		? (value as Ref<T>).value
		: value;
}

export function useWasmIdlePlayground(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>
): Ref<PlaygroundBinding> {
	return computed(() => createPlaygroundBinding(unwrap(runtimeAssets), unwrap(loadSandbox)));
}

export function useWasmIdleHost(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>
): VueWasmIdleHost {
	const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox);
	const terminal = shallowRef<TerminalControl | undefined>(undefined);
	return {
		binding,
		terminal,
		terminalProps: computed(() => binding.value.terminalProps),
		setTerminal(nextTerminal) {
			terminal.value = nextTerminal;
		}
	};
}

export type {
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
