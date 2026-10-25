// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { PYODIDE_PACKAGE_ASSETS } from '../../../runtimes/pyodide/src/index';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('pyodide/package.json'));
const staticRoot = new URL('../../../static/', import.meta.url);

it('ships the installed Pyodide release for execution and language services', async () => {
	const installedPackage = JSON.parse(
		await readFile(path.join(packageRoot, 'package.json'), 'utf8')
	);
	for (const manifest of [
		'package.json',
		'runtimes/pyodide/package.json',
		'packages/lsp/package.json'
	]) {
		const declared = JSON.parse(
			await readFile(new URL(`../../../${manifest}`, import.meta.url), 'utf8')
		);
		expect(declared.devDependencies.pyodide, manifest).toBe(installedPackage.version);
	}
	const compressed = JSON.parse(
		await readFile(new URL('compressed-runtime-assets.v1.json', staticRoot), 'utf8')
	) as { assets: string[]; sizes: Record<string, number> };
	for (const asset of PYODIDE_PACKAGE_ASSETS) {
		const logicalPath = `pyodide/${asset}`;
		const encoded = compressed.assets.includes(logicalPath);
		const stored = await readFile(new URL(`${logicalPath}${encoded ? '.gz' : ''}`, staticRoot));
		const bytes = encoded ? gunzipSync(stored) : stored;
		const expected = await readFile(path.join(packageRoot, asset));
		expect(bytes.equals(expected), asset).toBe(true);
		if (encoded) expect(compressed.sizes[logicalPath], asset).toBe(expected.length);
	}
});

it('ships the exact NumPy and Jedi wheel dependency closure from the installed Pyodide lock', async () => {
	const lock = JSON.parse(
		await readFile(path.join(packageRoot, 'pyodide-lock.json'), 'utf8')
	) as {
		packages: Record<string, { file_name: string; sha256: string; depends: string[] }>;
	};
	const pending = ['numpy', 'jedi'];
	const visited = new Set<string>();
	const expectedFiles = [];
	for (const name of pending) {
		if (visited.has(name)) continue;
		visited.add(name);
		const wheel = lock.packages[name];
		expect(wheel, name).toBeDefined();
		const bytes = await readFile(new URL(`pyodide/${wheel.file_name}`, staticRoot));
		expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(wheel.sha256);
		expectedFiles.push(wheel.file_name);
		pending.push(...wheel.depends);
	}
	const shipped = (await readdir(new URL('pyodide/', staticRoot))).filter((name) =>
		name.endsWith('.whl')
	);
	expect(shipped.sort()).toEqual(expectedFiles.sort());
});
