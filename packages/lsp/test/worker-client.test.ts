import { describe, expect, it } from 'vitest';

import {
	createLanguageServerProgressReporter,
	type LanguageServerStatus
} from '../src/worker-client.js';

describe('createLanguageServerProgressReporter', () => {
	it('reports stage-aware fallback progress for non-numeric updates', () => {
		const statuses: LanguageServerStatus[] = [];
		const reporter = createLanguageServerProgressReporter((status) => {
			statuses.push(status);
		});

		reporter.loading();
		reporter.progress({ stage: 'load-pyodide' });
		reporter.progress({ stage: 'load-jedi' });
		reporter.ready();

		expect(statuses).toEqual([
			{ state: 'loading', stage: 'startup', loaded: 0, total: 1 },
			{ state: 'loading', stage: 'load-pyodide', loaded: 0.35, total: 1 },
			{ state: 'loading', stage: 'load-jedi', loaded: 0.72, total: 1 },
			{ state: 'ready' }
		]);
	});

	it('keeps explicit progress payloads and uses them as the monotonic baseline', () => {
		const statuses: LanguageServerStatus[] = [];
		const reporter = createLanguageServerProgressReporter((status) => {
			statuses.push(status);
		});

		reporter.loading();
		reporter.progress({ stage: 'download-clangd', loaded: 3, total: 6 });
		reporter.progress({ stage: 'load-clangd' });

		expect(statuses).toEqual([
			{ state: 'loading', stage: 'startup', loaded: 0, total: 1 },
			{ state: 'loading', stage: 'download-clangd', loaded: 3, total: 6 },
			{ state: 'loading', stage: 'load-clangd', loaded: 0.5, total: 1 }
		]);
	});
});
