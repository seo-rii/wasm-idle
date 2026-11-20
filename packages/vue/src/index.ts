import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type PlaygroundBindingOptions,
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
	watch,
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

function disposeInBackground(dispose: () => Promise<void>) {
	try {
		void dispose().catch(() => undefined);
	} catch {
		// Vue lifecycle callbacks cannot await cleanup. Explicit dispose() still reports failures.
	}
}

export function useWasmIdlePlayground(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>,
	options?: MaybeRef<PlaygroundBindingOptions | undefined>
): Ref<PlaygroundBinding> {
	function createBinding(): PlaygroundBinding {
		const next = createPlaygroundBinding(
			unref(runtimeAssets),
			unref(loadSandbox),
			unref(options)
		);
		const dispose = next.dispose;
		next.dispose = () => {
			if (current.value === next) stop();
			return dispose();
		};
		return next;
	}
	const current = shallowRef(createBinding());
	const stop = watch(
		[() => unref(runtimeAssets), () => unref(loadSandbox), () => unref(options)],
		() => {
			const previous = current.value;
			current.value = createBinding();
			disposeInBackground(previous.dispose);
		},
		{ flush: 'sync' }
	);
	if (getCurrentScope()) {
		onScopeDispose(() => disposeInBackground(current.value.dispose));
	}
	return computed(() => current.value);
}

export function useWasmIdleHost(
	runtimeAssets: MaybeRef<SandboxRuntimeAssets>,
	loadSandbox: MaybeRef<SandboxLoader>,
	options?: MaybeRef<PlaygroundBindingOptions | undefined>
): VueWasmIdleHost {
	const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox, options);
	const terminal = shallowRef<TerminalControl | undefined>(undefined);
	const dispose = async () => {
		const currentTerminal = terminal.value;
		terminal.value = undefined;
		const failures: unknown[] = [];
		try {
			if (currentTerminal) await currentTerminal.destroy();
		} catch (error) {
			failures.push(error);
		}
		try {
			await binding.value.dispose();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Failed to dispose the Vue wasm-idle host');
		}
	};
	if (getCurrentScope()) onScopeDispose(() => disposeInBackground(dispose));
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
	PlaygroundBindingOptions,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
