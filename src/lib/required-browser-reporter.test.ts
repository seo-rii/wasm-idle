import { describe, expect, it } from 'vitest';
import { assertRequiredBrowserTests } from '../../scripts/required-browser-reporter.mjs';

function moduleWith(...tests: Array<[boolean, string]>) {
	return {
		children: {
			allTests: () =>
				tests.map(([requiredBrowser, state]) => ({
					meta: () => ({ requiredBrowser }),
					result: () => ({ state }),
					fullName: 'browser case'
				}))
		}
	};
}

describe('required browser execution gate', () => {
	it('rejects an empty selection and optional-only runs', () => {
		expect(() => assertRequiredBrowserTests([])).toThrow('No required browser tests');
		expect(() => assertRequiredBrowserTests([moduleWith([false, 'passed'])])).toThrow(
			'No required browser tests'
		);
	});
	it.each(['skipped', 'pending', 'failed'])('rejects a required %s test', (state) => {
		expect(() => assertRequiredBrowserTests([moduleWith([true, state])])).toThrow(state);
	});
	it('allows optional skips only when every required case passed', () => {
		expect(() =>
			assertRequiredBrowserTests([moduleWith([true, 'passed'], [false, 'skipped'])])
		).not.toThrow();
	});
});
