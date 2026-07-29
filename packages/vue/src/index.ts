import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type SandboxLoader,
	type SandboxRuntimeAssets,
	type TerminalControl
} from '@wasm-idle/core';
import {
	computed,
	getCurrentScope,
	onScopeDispose,
	shallowRef,
	unref,
	type Ref,
	type ShallowRef
} from 'vue';

export type MaybeRef<T> = T | Ref<T>;

export interface VueWasmIdleHost {
	binding: Ref<PlaygroundBinding>;
	terminal: ShallowRef<TerminalControl | undefined>;
	terminalProps: Ref<PlaygroundBinding['terminalProps']>;
	setTerminal: (terminal: TerminalControl | undefined) => void;
	dispose: () => Promise<void>;
}

export function useWasmIdlePlayground(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>
): Ref<PlaygroundBinding> {
	let currentAssets = unref(runtimeAssets);
	let currentLoader = unref(loadSandbox);
	let currentBinding = createPlaygroundBinding(currentAssets, currentLoader);
	const binding = computed(() => {
		const nextAssets = unref(runtimeAssets);
		const nextLoader = unref(loadSandbox);
		if (nextAssets !== currentAssets || nextLoader !== currentLoader) {
			const previousBinding = currentBinding;
			currentAssets = nextAssets;
			currentLoader = nextLoader;
			currentBinding = createPlaygroundBinding(nextAssets, nextLoader);
			void previousBinding.dispose();
		}
		return currentBinding;
	});
	if (getCurrentScope()) onScopeDispose(() => void currentBinding.dispose());
	return binding;
}

export function useWasmIdleHost(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>
): VueWasmIdleHost {
	const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox);
	const terminal = shallowRef<TerminalControl | undefined>(undefined);
	const dispose = async () => {
		const currentTerminal = terminal.value;
		terminal.value = undefined;
		if (currentTerminal) await currentTerminal.destroy();
		await binding.value.dispose();
	};
	if (getCurrentScope()) onScopeDispose(() => void dispose());
	return {
		binding,
		terminal,
		terminalProps: computed(() => binding.value.terminalProps),
		setTerminal(nextTerminal) {
			terminal.value = nextTerminal;
		},
		dispose
	};
}

export type {
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
