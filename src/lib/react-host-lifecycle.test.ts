import { describe, expect, it, vi } from 'vitest';

import { disposeReactTerminalRef } from '../../packages/react/src/lifecycle';

describe('React wasm-idle host lifecycle', () => {
	it('destroys the terminal exactly once across unmount and explicit disposal', async () => {
		const destroy = vi.fn(async () => undefined);
		const terminalRef = { current: { destroy } as never };
		const clearTerminal = vi.fn();

		await Promise.all([
			disposeReactTerminalRef(terminalRef),
			disposeReactTerminalRef(terminalRef, clearTerminal)
		]);
		await disposeReactTerminalRef(terminalRef, clearTerminal);

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(clearTerminal).toHaveBeenCalledTimes(2);
		expect(terminalRef.current).toBeUndefined();
	});
});
