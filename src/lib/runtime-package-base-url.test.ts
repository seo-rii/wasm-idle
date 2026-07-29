import { normalizeQuickJsBaseUrl } from '../../runtimes/js-sandbox/src/index';
import { loadWasmIdlePyodide, normalizePyodideBaseUrl } from '../../runtimes/pyodide/src/index';
import { normalizeWebRBaseUrl } from '../../runtimes/r/src/index';
import { normalizeRubyBaseUrl } from '../../runtimes/ruby/src/index';
import { normalizeTeaVmBaseUrl } from '../../runtimes/teavm/src/index';
import { describe, expect, it } from 'vitest';

const resolvers = [
	['Pyodide', normalizePyodideBaseUrl],
	['webR', normalizeWebRBaseUrl],
	['Ruby', normalizeRubyBaseUrl],
	['TeaVM', normalizeTeaVmBaseUrl],
	['QuickJS', normalizeQuickJsBaseUrl]
] as const;

describe('standalone runtime package asset bases', () => {
	it.each(resolvers)('%s rejects an omitted or blank asset base', (_name, normalize) => {
		expect(() => normalize(undefined as never)).toThrow('asset base URL is required');
		expect(() => normalize('  ')).toThrow('asset base URL is required');
	});

	it.each(resolvers)('%s resolves an explicit nested deployment base', (_name, normalize) => {
		expect(normalize('./runtime', 'https://example.test/wasm-idle/')).toBe(
			'https://example.test/wasm-idle/runtime/'
		);
		expect(normalize('./runtime', 'https://example.test/foo/bar/')).toBe(
			'https://example.test/foo/bar/runtime/'
		);
	});

	it.each(resolvers)('%s preserves an explicitly selected root base', (_name, normalize) => {
		expect(normalize('/runtime')).toBe('/runtime/');
	});

	it('requires Pyodide callers to provide a base URL or indexURL', async () => {
		await expect(
			loadWasmIdlePyodide({ loadPyodide: async () => ({}) as never })
		).rejects.toThrow('Pyodide indexURL or asset base URL is required');
		await expect(
			loadWasmIdlePyodide({ indexURL: '  ', loadPyodide: async () => ({}) as never })
		).rejects.toThrow('Pyodide indexURL must be non-empty');
	});

	it('preserves an explicitly supplied Pyodide indexURL', async () => {
		let receivedIndexUrl: string | undefined;
		await loadWasmIdlePyodide({
			indexURL: 'https://cdn.example.test/pyodide/',
			loadPyodide: async (options) => {
				receivedIndexUrl = options?.indexURL;
				return {} as never;
			}
		});
		expect(receivedIndexUrl).toBe('https://cdn.example.test/pyodide/');
	});
});
