import type { TerminalControl } from '@wasm-idle/core';

export interface ReactTerminalRef {
	current: TerminalControl | undefined;
}

export async function disposeReactTerminalRef(
	terminalRef: ReactTerminalRef,
	clearTerminal?: () => void
): Promise<void> {
	const currentTerminal = terminalRef.current;
	terminalRef.current = undefined;
	clearTerminal?.();
	if (currentTerminal) await currentTerminal.destroy();
}
