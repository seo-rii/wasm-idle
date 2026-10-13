import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithSignalAndTimeout, waitForLanguageServerStartup } from '../src/lifecycle.js';

describe('language service timeout limits', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it.each([0, -1, 0.5, NaN, Infinity, 2 ** 31, Number.MAX_SAFE_INTEGER])(
		'rejects an unsupported timeout before starting work: %s',
		async (timeoutMs) => {
			const operation = vi.fn(async () => 'finished');
			const timer = vi.spyOn(globalThis, 'setTimeout');
			await expect(
				runWithSignalAndTimeout(operation, {
					timeoutMs,
					operationName: 'Test operation',
					timeoutError: () => new Error('timed out')
				})
			).rejects.toThrow(
				'Test operation timeout must be an integer between 1 and 2147483647 ms'
			);
			expect(operation).not.toHaveBeenCalled();
			expect(timer).not.toHaveBeenCalled();
		}
	);

	it('supports the maximum timer delay without clamping or leaking the timer', async () => {
		vi.useFakeTimers();
		const timer = vi.spyOn(globalThis, 'setTimeout');
		const start = vi.fn(async () => {});
		await waitForLanguageServerStartup(start, { timeoutMs: 2 ** 31 - 1 });
		expect(start).toHaveBeenCalledOnce();
		expect(timer).toHaveBeenCalledWith(expect.any(Function), 2 ** 31 - 1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('still aborts a stalled operation at an ordinary deadline', async () => {
		vi.useFakeTimers();
		let operationSignal: AbortSignal | undefined;
		const timedOut = new Error('timed out');
		const operation = runWithSignalAndTimeout(
			(signal) => {
				operationSignal = signal;
				return new Promise<never>(() => {});
			},
			{ timeoutMs: 10, operationName: 'Test operation', timeoutError: () => timedOut }
		);
		const rejection = expect(operation).rejects.toBe(timedOut);
		await vi.advanceTimersByTimeAsync(10);
		await rejection;
		expect(operationSignal?.aborted).toBe(true);
		expect(operationSignal?.reason).toBe(timedOut);
		expect(vi.getTimerCount()).toBe(0);
	});
});
