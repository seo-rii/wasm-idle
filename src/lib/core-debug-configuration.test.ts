import { describe, expect, it } from 'vitest';
import {
	assertDebugBreakpointSupport,
	mergeDebugBreakpointLines,
	normalizeDebugSourceBreakpoints,
	normalizeDebugSteppingOptions
} from '../../packages/core/src/debug-configuration';

describe('public debugger configuration', () => {
	it('copies disabled and conditional configurations without silently dropping unsupported features', () => {
		const input = [
			{
				line: 7,
				enabled: false,
				condition: 'ready',
				hitCondition: '3',
				logMessage: '{ready}'
			}
		];
		const copied = normalizeDebugSourceBreakpoints(input);
		input[0].condition = 'changed';
		expect(copied[0].condition).toBe('ready');
		expect(() => assertDebugBreakpointSupport(copied, {})).not.toThrow();
		expect(() =>
			assertDebugBreakpointSupport(mergeDebugBreakpointLines(copied, [7]), {})
		).toThrow('condition');
		expect(mergeDebugBreakpointLines(copied, [])).toEqual([]);
		expect(mergeDebugBreakpointLines(copied, [8])).toEqual([{ line: 8 }]);
		expect(() =>
			assertDebugBreakpointSupport(mergeDebugBreakpointLines(copied, [7]), {
				conditionalBreakpoints: true,
				hitConditionalBreakpoints: true,
				logPoints: true
			})
		).not.toThrow();
	});

	it.each(['0', '-1', '>=3', '3.0', '4294967296', '9'.repeat(100)])(
		'rejects unsupported hit-count syntax %s',
		(hitCondition) => {
			expect(() => normalizeDebugSourceBreakpoints([{ line: 3, hitCondition }])).toThrow(
				'hitCondition'
			);
		}
	);

	it('bounds source configurations and accepts only fixed boolean stepping policy', () => {
		expect(() =>
			normalizeDebugSourceBreakpoints([{ line: 1, logMessage: 'x'.repeat(4097) }])
		).toThrow('4096');
		expect(() =>
			normalizeDebugSourceBreakpoints(Array.from({ length: 1025 }, () => ({ line: 1 })))
		).toThrow('1024');
		expect(normalizeDebugSteppingOptions({ skipLibraryCode: false })).toEqual({
			skipLibraryCode: false
		});
		expect(() =>
			normalizeDebugSteppingOptions({ skipLibraryCode: true, command: 'anything' } as never)
		).toThrow('only');
	});
});
