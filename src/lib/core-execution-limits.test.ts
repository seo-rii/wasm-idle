import {
	defineRuntimeWorkerLifetimePolicy,
	resolveExecutionLimits,
	type ExecutionLimits
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

describe('platform timer limits', () => {
	it.each(['assetTimeoutMs', 'startupTimeoutMs', 'compileTimeoutMs', 'runTimeoutMs'] as const)(
		'accepts the largest supported %s and rejects values that overflow a timer',
		(name: keyof ExecutionLimits) => {
			expect(resolveExecutionLimits({ [name]: 2_147_483_647 })[name]).toBe(2_147_483_647);
			for (const value of [
				2_147_483_648,
				Number.MAX_SAFE_INTEGER,
				NaN,
				Infinity,
				0,
				-1,
				1.5
			]) {
				expect(() => resolveExecutionLimits({ [name]: value })).toThrow(/Execution limit/);
			}
		}
	);

	it.each(['persistent', 'pool'] as const)('bounds %s worker idle timers', (mode) => {
		const policy = {
			mode,
			idleTimeoutMs: 2_147_483_647,
			maxWorkers: 2,
			evictOnMemoryPressure: true
		};
		expect(defineRuntimeWorkerLifetimePolicy(policy).mode).toBe(mode);
		expect(() =>
			defineRuntimeWorkerLifetimePolicy({ ...policy, idleTimeoutMs: 2_147_483_648 })
		).toThrow('2147483647');
	});

	it('keeps byte budgets independent of the timer ceiling', () => {
		expect(resolveExecutionLimits({ maxWasmMemoryBytes: 2 ** 32 }).maxWasmMemoryBytes).toBe(
			2 ** 32
		);
	});
});
