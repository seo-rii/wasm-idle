import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type PlaygroundBindingOptions,
	type SandboxLoader,
	type SandboxRuntimeAssets,
	type TerminalControl
} from '@wasm-idle/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { disposeReactTerminalRef } from './lifecycle.js';

export interface ReactWasmIdleHost {
	binding: PlaygroundBinding;
	terminal: TerminalControl | undefined;
	setTerminal: (terminal: TerminalControl | undefined) => void;
	terminalRef: { current: TerminalControl | undefined };
	terminalProps: PlaygroundBinding['terminalProps'];
	dispose: () => Promise<void>;
}

export function useWasmIdlePlayground(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options: PlaygroundBindingOptions = {}
): PlaygroundBinding {
	const [generation, recreate] = useReducer((count: number) => count + 1, 0);
	const owner = useMemo(
		() => ({
			binding: createPlaygroundBinding(runtimeAssets, loadSandbox, options),
			mounted: false,
			disposed: false
		}),
		// Key on option fields so an inline options object does not replace the binding every render.
		[
			runtimeAssets,
			loadSandbox,
			options.persistentCache,
			options.prewarm,
			options.trustProfile,
			generation
		]
	);
	useEffect(() => {
		// A hidden <Activity> releases the binding but keeps memoized state; replace it when shown.
		if (owner.disposed) {
			recreate();
			return;
		}
		owner.mounted = true;
		return () => {
			owner.mounted = false;
			// StrictMode and Fast Refresh re-run this effect synchronously after the cleanup, so only
			// release the binding when nothing mounted it again.
			void Promise.resolve()
				.then(() => {
					if (owner.mounted || owner.disposed) return;
					owner.disposed = true;
					return owner.binding.dispose();
				})
				.catch(() => {});
		};
	}, [owner]);
	return owner.binding;
}

export function useWasmIdleHost(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options?: PlaygroundBindingOptions
): ReactWasmIdleHost {
	const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox, options);
	const terminalRef = useRef<TerminalControl | undefined>(undefined);
	const [terminal, setTerminalState] = useState<TerminalControl | undefined>(undefined);
	const setTerminal = useCallback((nextTerminal: TerminalControl | undefined) => {
		terminalRef.current = nextTerminal;
		setTerminalState(nextTerminal);
	}, []);
	useEffect(
		() => () => {
			void disposeReactTerminalRef(terminalRef).catch(() => {});
		},
		[]
	);
	const dispose = useCallback(async () => {
		const failures: unknown[] = [];
		try {
			await disposeReactTerminalRef(terminalRef, () => setTerminalState(undefined));
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
			throw new AggregateError(failures, 'Failed to dispose the React wasm-idle host');
		}
	}, [binding]);
	return {
		binding,
		terminal,
		setTerminal,
		terminalRef,
		terminalProps: binding.terminalProps,
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
