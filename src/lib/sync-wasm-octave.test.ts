import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmOctaveAssets } from '../../scripts/sync-wasm-octave.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-octave-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(
	baseDir: string,
	relativePath: string,
	contents: string | Uint8Array
) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

describe('syncWasmOctaveAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies runtime Octave assets and excludes development-only package files', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOctaveVersion.ts');
		const runnerWorkerPath = path.join(await makeTempDir(), 'runner-worker.js');

		await writeFixtureFile(sourceDir, 'bin/octave-cli-10.3.0', 'wrapper');
		await writeFixtureFile(
			sourceDir,
			'bin/octave-cli.wasm',
			new Uint8Array([0, 97, 115, 109, 1])
		);
		await writeFixtureFile(
			sourceDir,
			'lib/octave/10.3.0/liboctave.so',
			new Uint8Array([1, 2, 3])
		);
		await writeFixtureFile(
			sourceDir,
			'lib/octave/10.3.0/liboctave.a',
			new Uint8Array([4, 5, 6])
		);
		await writeFixtureFile(
			sourceDir,
			'lib/octave/10.3.0/oct/wasm32-unknown-emscripten/__ode15__.oct',
			new Uint8Array([7, 8, 9])
		);
		await writeFixtureFile(
			sourceDir,
			'share/octave/10.3.0/m/general/disp.m',
			'function disp(x)\nendfunction\n'
		);
		await writeFixtureFile(sourceDir, 'share/octave/site/m/startup/octaverc', 'more off;\n');
		await writeFixtureFile(sourceDir, 'include/octave-10.3.0/octave/oct.h', 'header');
		await writeFixtureFile(sourceDir, 'info/index.json', '{}\n');
		await writeFixtureFile(runnerWorkerPath, '', 'worker');

		const result = await syncWasmOctaveAssets({
			sourceDir,
			targetDir,
			versionModulePath,
			runnerWorkerPath
		});

		await expect(
			readFile(path.join(targetDir, 'bin/octave-cli-10.3.0.js'), 'utf8')
		).resolves.toBe('wrapper');
		await expect(readFile(path.join(targetDir, 'bin/octave-cli-10.3.0'), 'utf8')).resolves.toBe(
			'wrapper'
		);
		await expect(readFile(path.join(targetDir, 'bin/octave-cli.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109, 1])
		);
		await expect(
			readFile(path.join(targetDir, 'lib/octave/10.3.0/liboctave.so'))
		).resolves.toEqual(Buffer.from([1, 2, 3]));
		await expect(
			readFile(
				path.join(
					targetDir,
					'lib/octave/10.3.0/oct/wasm32-unknown-emscripten/__ode15__.oct'
				)
			)
		).resolves.toEqual(Buffer.from([7, 8, 9]));
		await expect(
			readFile(path.join(targetDir, 'share/octave/10.3.0/m/general/disp.m'), 'utf8')
		).resolves.toContain('function disp');
		await expect(
			readFile(path.join(targetDir, 'share/octave/site/m/startup/octaverc'), 'utf8')
		).resolves.toContain('more off');
		await expect(stat(path.join(targetDir, 'lib/octave/10.3.0/liboctave.a'))).rejects.toThrow();
		await expect(
			stat(path.join(targetDir, 'include/octave-10.3.0/octave/oct.h'))
		).rejects.toThrow();
		await expect(stat(path.join(targetDir, 'info/index.json'))).rejects.toThrow();

		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; entryScript: string; entryWasm: string; files: { path: string }[] };
		expect(manifest.format).toBe('wasm-octave-runtime-manifest-v1');
		expect(manifest.entryScript).toBe('bin/octave-cli-10.3.0.js');
		expect(manifest.entryWasm).toBe('bin/octave-cli.wasm');
		expect(manifest.files.map((file) => file.path)).toEqual(
			expect.arrayContaining([
				'bin/octave-cli-10.3.0.js',
				'bin/octave-cli-10.3.0',
				'bin/octave-cli.wasm',
				'lib/octave/10.3.0/liboctave.so',
				'lib/octave/10.3.0/oct/wasm32-unknown-emscripten/__ode15__.oct',
				'share/octave/10.3.0/m/general/disp.m',
				'share/octave/site/m/startup/octaverc'
			])
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_OCTAVE_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('fails when the source package is missing required runtime assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOctaveVersion.ts');

		await writeFixtureFile(sourceDir, 'bin/octave-cli-10.3.0', 'wrapper');

		await expect(
			syncWasmOctaveAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('Octave runtime asset bin/octave-cli.wasm was not found');
	});
});
