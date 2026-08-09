import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function writeFixtureFile(root: string, relativePath: string, contents: string) {
	const filePath = path.join(root, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents);
}

async function writeTarZstdFixture(root: string, asset: string, entry: string) {
	const sourceDir = path.join(root, `${asset}.source`);
	await writeFixtureFile(sourceDir, entry, `${asset}\n`);
	const archivePath = path.join(root, asset);
	await mkdir(path.dirname(archivePath), { recursive: true });
	await execFileAsync('tar', [
		'--zstd',
		'--sort=name',
		'--mtime=@0',
		'--owner=0',
		'--group=0',
		'--numeric-owner',
		'-cf',
		archivePath,
		'-C',
		sourceDir,
		'.'
	]);
}

describe('wasm-d runtime producer', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('records the generated target manifest digest in its build receipt', async () => {
		const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-d-producer-test-'));
		tempDirs.push(tempRoot);
		const sourceDir = path.join(tempRoot, 'source');
		const targetDir = path.join(tempRoot, 'target');

		await writeFixtureFile(sourceDir, 'bin/ldc2.wasm', 'fixture ldc2');
		await writeFixtureFile(sourceDir, 'bin/lld.js', 'export default () => ({});');
		await writeFixtureFile(sourceDir, 'bin/lld.wasm', 'fixture lld wasm');
		await writeFixtureFile(sourceDir, 'bin/lld.data', 'fixture lld data');
		await writeTarZstdFixture(sourceDir, 'archives/config.tar.zst', 'ldc2.conf');
		await writeTarZstdFixture(sourceDir, 'archives/imports.tar.zst', 'object.d');
		await writeTarZstdFixture(sourceDir, 'archives/runtime-libraries.tar.zst', 'libphobos2.a');
		await writeFixtureFile(
			sourceDir,
			'runtime-manifest.v1.json',
			`${JSON.stringify({
				manifestVersion: 1,
				name: 'ldc-wasm',
				version: 'test',
				compiler: {
					ldc2: { asset: 'bin/ldc2.wasm' },
					config: { asset: 'archives/config.tar.zst' },
					imports: { asset: 'archives/imports.tar.zst' },
					runtimeLibraries: { asset: 'archives/runtime-libraries.tar.zst' },
					linker: {
						js: { asset: 'bin/lld.js' },
						wasm: { asset: 'bin/lld.wasm' },
						data: { asset: 'bin/lld.data' }
					}
				}
			})}\n`
		);

		await execFileAsync(
			'node',
			['scripts/prepare-runtime.mjs', '--source', sourceDir, '--out', targetDir],
			{
				cwd: runtimeRoot,
				env: { ...process.env, SOURCE_DATE_EPOCH: '0' }
			}
		);

		const targetManifestBytes = await readFile(
			path.join(targetDir, 'runtime-manifest.v1.json')
		);
		const sourceManifestBytes = await readFile(
			path.join(sourceDir, 'runtime-manifest.v1.json')
		);
		const buildReceipt = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')
		);

		expect(buildReceipt.manifestSha256).toBe(sha256(targetManifestBytes));
		expect(buildReceipt.manifestSha256).not.toBe(sha256(sourceManifestBytes));
	});
});
