import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	PHP_RUNTIME_PACKAGES,
	syncWasmPhpAssets,
	validatePhpRuntimeAssets
} from '../../scripts/sync-wasm-php.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-php-'));
	tempDirs.push(directory);
	return directory;
}

async function writeFixture(
	directory: string,
	files: Record<string, Buffer | string>,
	packages: Record<string, string> = PHP_RUNTIME_PACKAGES
) {
	const manifestFiles = [];
	for (const [relativePath, value] of Object.entries(files)) {
		const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const targetPath = path.join(directory, relativePath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, bytes);
		manifestFiles.push({
			path: relativePath,
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
	}
	await writeFile(
		path.join(directory, 'runtime-manifest.v1.json'),
		`${JSON.stringify(
			{
				formatVersion: 1,
				runtimeModule: 'runtime.mjs',
				packages,
				files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path))
			},
			null,
			2
		)}\n`,
		'utf8'
	);
}

describe('wasm-php producer assets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('atomically replaces the static tree with validated producer output', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixture(sourceDir, {
			'runtime.mjs': 'export const php = true;\n',
			'assets/php.wasm': Buffer.from([0, 97, 115, 109]),
			'LICENSE.txt': 'PHP license\n'
		});
		await writeFile(path.join(targetDir, 'stale.txt'), 'stale', 'utf8');

		const result = await syncWasmPhpAssets({ sourceDir, targetDir });

		expect(result.manifest.packages).toEqual(PHP_RUNTIME_PACKAGES);
		await expect(readFile(path.join(targetDir, 'runtime.mjs'), 'utf8')).resolves.toContain(
			'php = true'
		);
		await expect(readFile(path.join(targetDir, 'assets/php.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109])
		);
		await expect(access(path.join(targetDir, 'stale.txt'))).rejects.toThrow();
	});

	it('rejects corrupted producer output without replacing the current target', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const runtimeBytes = Buffer.from('export const php = true;\n');
		await writeFixture(sourceDir, { 'runtime.mjs': runtimeBytes });
		runtimeBytes[0] ^= 0xff;
		await writeFile(path.join(sourceDir, 'runtime.mjs'), runtimeBytes);
		await writeFile(path.join(targetDir, 'current.txt'), 'keep me', 'utf8');

		await expect(syncWasmPhpAssets({ sourceDir, targetDir })).rejects.toThrow(
			'SHA-256 mismatch'
		);
		await expect(readFile(path.join(targetDir, 'current.txt'), 'utf8')).resolves.toBe(
			'keep me'
		);
	});

	it('validates gzip-compressed checked-in assets against their logical manifest entries', async () => {
		const runtimeDir = await makeTempDir();
		const runtimeBytes = Buffer.from('export const php = true;\n');
		await writeFixture(runtimeDir, { 'runtime.mjs': runtimeBytes });
		await writeFile(path.join(runtimeDir, 'runtime.mjs.gz'), gzipSync(runtimeBytes));
		await rm(path.join(runtimeDir, 'runtime.mjs'));

		await expect(
			validatePhpRuntimeAssets(runtimeDir, { allowCompressed: true })
		).resolves.toMatchObject({ runtimeModule: 'runtime.mjs' });
		await expect(validatePhpRuntimeAssets(runtimeDir)).rejects.toThrow('asset is missing');
	});

	it('rejects producer output built from a different PHP package version', async () => {
		const sourceDir = await makeTempDir();
		await writeFixture(
			sourceDir,
			{ 'runtime.mjs': 'export const php = true;\n' },
			{ ...PHP_RUNTIME_PACKAGES, '@php-wasm/web-8-4': '3.1.35' }
		);

		await expect(validatePhpRuntimeAssets(sourceDir)).rejects.toThrow(
			'package metadata mismatch'
		);
	});
});
