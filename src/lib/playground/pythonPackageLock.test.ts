import { describe, expect, it } from 'vitest';
import { parsePythonPackageLock } from './pythonPackageLock';

const encodeLock = (packages: Record<string, unknown>) =>
	new TextEncoder().encode(JSON.stringify({ info: {}, packages }));

describe('Python package lock boundary', () => {
	it('returns the parsed lock and an exact package asset allowlist', () => {
		const lockBytes = encodeLock({
			numpy: { file_name: 'numpy-2.3.3-py3-none-any.whl' },
			archive: { file_name: 'archive-tests.tar' }
		});

		const parsed = parsePythonPackageLock(lockBytes);

		expect(parsed.lock).toEqual({
			info: {},
			packages: {
				numpy: { file_name: 'numpy-2.3.3-py3-none-any.whl' },
				archive: { file_name: 'archive-tests.tar' }
			}
		});
		expect(parsed.packageAssets).toEqual(
			new Set(['numpy-2.3.3-py3-none-any.whl', 'archive-tests.tar'])
		);
	});

	it.each([
		'../numpy.whl',
		'nested/numpy.whl',
		'https://untrusted.example/numpy.whl',
		'numpy.whl?mirror=untrusted',
		'numpy.whl#fragment',
		'numpy.wasm'
	])('rejects an unsafe package URL or path before Pyodide sees it: %s', (fileName) => {
		expect(() =>
			parsePythonPackageLock(encodeLock({ numpy: { file_name: fileName } }))
		).toThrow('Python runtime lock file has an unsafe package asset name');
	});

	it('rejects an unbounded package map before constructing an allowlist', () => {
		const packages = Object.fromEntries(
			Array.from({ length: 4097 }, (_, index) => [
				`package-${index}`,
				{ file_name: `package-${index}.whl` }
			])
		);

		expect(() => parsePythonPackageLock(encodeLock(packages))).toThrow(
			'Python runtime lock file has too many package assets'
		);
	});
});
