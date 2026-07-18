import pythonWorkerSource from '../src/python/worker.ts?raw';
import rServiceSource from '../src/r/service.ts?raw';
import { describe, expect, it } from 'vitest';

describe('static runtime loader modules', () => {
	it('loads Pyodide from the configured Python runtime URL', () => {
		expect(pythonWorkerSource).toContain(
			'/* @vite-ignore */ `${normalizeBaseUrl(pyodideBaseUrl)}pyodide.mjs`'
		);
		expect(pythonWorkerSource).not.toContain("import { loadPyodide } from 'pyodide';");
	});

	it('loads WebR from the configured R runtime URL', () => {
		expect(rServiceSource).toContain('/* @vite-ignore */ `${normalizedBaseUrl}webr.js`');
		expect(rServiceSource).not.toContain("import { ChannelType, WebR } from 'webr';");
	});
});
