// @vitest-environment node

import { evaluateQuickJs, type QuickJsModuleLike } from '../../runtimes/js-sandbox/src/index';
import { describe, expect, it, vi } from 'vitest';

describe('evaluateQuickJs', () => {
	it('returns primitive and JSON-compatible results from real QuickJS', async () => {
		await expect(evaluateQuickJs('1 + 2')).resolves.toEqual({ value: 3 });
		await expect(evaluateQuickJs('"wasm".toUpperCase()')).resolves.toEqual({
			value: 'WASM'
		});
		await expect(evaluateQuickJs('({ items: [1, "two", null], ok: true })')).resolves.toEqual({
			value: { items: [1, 'two', null], ok: true }
		});
	});

	it('rejects with Error instances when code throws or exceeds its deadline inside QuickJS', async () => {
		await expect(evaluateQuickJs('throw new TypeError("boom")')).rejects.toSatisfy(
			(error) =>
				error instanceof Error &&
				error.name === 'TypeError' &&
				error.message === 'boom' &&
				!!error.stack?.includes('eval.js')
		);
		await expect(evaluateQuickJs('throw 42')).rejects.toSatisfy(
			(error) => error instanceof Error && error.message === '42' && error.cause === 42
		);
		await expect(evaluateQuickJs('while (true) {}', { timeoutMs: 50 })).rejects.toSatisfy(
			(error) =>
				error instanceof Error &&
				error.name === 'InternalError' &&
				error.message === 'interrupted'
		);
	});

	it('rethrows host errors from the module evaluator unchanged', async () => {
		const failure = new RangeError('host failure');
		const quickJs: QuickJsModuleLike = {
			evalCode: () => {
				throw failure;
			}
		};

		await expect(evaluateQuickJs('source', { quickJs })).rejects.toBe(failure);
	});

	it('passes sandbox limits to the module evaluator and returns its value', async () => {
		const evalCode = vi.fn(() => ({ value: 'a property named value' }));
		const quickJs: QuickJsModuleLike = { evalCode };
		const shouldInterrupt = () => false;

		await expect(
			evaluateQuickJs('source', { quickJs, memoryLimitBytes: 1024, shouldInterrupt })
		).resolves.toEqual({ value: { value: 'a property named value' } });
		expect(evalCode).toHaveBeenCalledWith('source', {
			memoryLimitBytes: 1024,
			shouldInterrupt
		});
	});
});
