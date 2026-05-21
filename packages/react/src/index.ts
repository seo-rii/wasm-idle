import {
	createPlaygroundBinding,
	type PlaygroundBinding,
	type SandboxLoader,
	type SandboxRuntimeAssets,
	type TerminalControl
} from '@wasm-idle/core';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface ReactWasmIdleHost {
	binding: PlaygroundBinding;
	terminal: TerminalControl | undefined;
	setTerminal: (terminal: TerminalControl | undefined) => void;
	terminalRef: { current: TerminalControl | undefined };
	terminalProps: PlaygroundBinding['terminalProps'];
}

export function useWasmIdlePlayground(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): PlaygroundBinding {
	return useMemo(
		() => createPlaygroundBinding(runtimeAssets, loadSandbox),
		[runtimeAssets, loadSandbox]
	);
}

export function useWasmIdleHost(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): ReactWasmIdleHost {
	const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox);
	const terminalRef = useRef<TerminalControl | undefined>(undefined);
	const [terminal, setTerminalState] = useState<TerminalControl | undefined>(undefined);
	const setTerminal = useCallback((nextTerminal: TerminalControl | undefined) => {
		terminalRef.current = nextTerminal;
		setTerminalState(nextTerminal);
	}, []);
	return {
		binding,
		terminal,
		setTerminal,
		terminalRef,
		terminalProps: binding.terminalProps
	};
}

export type {
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets,
	TerminalControl
} from '@wasm-idle/core';
