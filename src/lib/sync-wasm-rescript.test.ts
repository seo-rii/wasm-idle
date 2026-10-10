// @vitest-environment node

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	RESCRIPT_RUNTIME_GLOBAL,
	buildReScriptRuntimeBundle,
	readReScriptInputLock,
	readTarFiles,
	syncWasmReScriptAssets
} from '../../scripts/sync-wasm-rescript.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const staticDir = path.join(repoRoot, 'static', 'wasm-rescript');
const tempDirs: string[] = [];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-rescript-'));
	tempDirs.push(directory);
	return directory;
}

function tarEntry(name: string, contents: string) {
	const data = Buffer.from(contents, 'utf8');
	const header = Buffer.alloc(512);
	header.write(name, 0, 'utf8');
	header.write('0000644\0', 100);
	header.write('0000000\0', 108);
	header.write('0000000\0', 116);
	header.write(`${data.byteLength.toString(8).padStart(11, '0')}\0`, 124);
	header.write('00000000000\0', 136);
	header.write('        ', 148);
	header.write('0', 156);
	header.write('ustar\0', 257);
	header.write('00', 263);
	let checksum = 0;
	for (const value of header) checksum += value;
	header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
	const padding = Buffer.alloc((512 - (data.byteLength % 512)) % 512);
	return Buffer.concat([header, data, padding]);
}

function fixtureTarball(entries: Record<string, string>) {
	return gzipSync(
		Buffer.concat([
			...Object.entries(entries).map(([name, contents]) => tarEntry(name, contents)),
			Buffer.alloc(1024)
		])
	);
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('sync-wasm-rescript', () => {
	it('pins upstream ReScript 12.3.1 inputs by URL, size, and SHA-256', async () => {
		const lock = await readReScriptInputLock();

		expect(lock.source).toEqual({
			repository: 'https://github.com/rescript-lang/rescript',
			revision: 'v12.3.1',
			commit: '679406560d169f1124653ab50795d5077570f078'
		});
		expect([...lock.components.keys()].sort()).toEqual([
			'compiler-builtins/cmij.js',
			'compiler.js',
			'rescript-runtime-12.3.1.tgz'
		]);
		expect(lock.components.get('compiler.js')?.url).toBe(
			'https://cdn.rescript-lang.org/v12.3.1/compiler.js'
		);
		expect(lock.components.get('rescript-runtime-12.3.1.tgz')?.integrity).toMatch(/^sha512-/u);
		expect(lock.license.spdx).toBe('LGPL-3.0-or-later AND MIT');
		expect(lock.bundle?.sha256).toMatch(/^[a-f0-9]{64}$/u);
	});

	it('wraps only top-level CommonJS runtime modules from the upstream tarball', () => {
		const tarball = fixtureTarball({
			'package/package.json': '{}',
			'package/lib/js/Stdlib_Int.js': "'use strict';\nexports.one = 1;\n",
			'package/lib/js/Belt_List.js': "'use strict';\nexports.two = 2;\n",
			'package/lib/es6/Stdlib_Int.js': 'export const one = 1;\n',
			'package/lib/js/nested/Ignored.js': 'exports.ignored = true;\n'
		});
		expect([...readTarFiles(Buffer.from(gzipSync(Buffer.alloc(1024))))]).toEqual([]);

		const { bytes, moduleCount } = buildReScriptRuntimeBundle({
			compiler: Buffer.from('globalThis.rescript_compiler = { make() {} };\n'),
			cmij: Buffer.from('/* cmij */\n'),
			runtimeTarball: tarball,
			version: '12.3.1'
		});
		const source = new TextDecoder().decode(bytes);

		expect(moduleCount).toBe(2);
		expect(source).toContain('modules["Belt_List.js"] = function (exports, require, module)');
		expect(source).toContain('modules["Stdlib_Int.js"]');
		expect(source).not.toContain('Ignored');
		expect(source).not.toContain('export const one');
		expect(source.indexOf('Belt_List.js')).toBeLessThan(source.indexOf('Stdlib_Int.js'));
		const scope: Record<string, any> = {};
		new Function('globalThis', source)(scope);
		expect(Object.keys(scope[RESCRIPT_RUNTIME_GLOBAL].modules)).toEqual([
			'Belt_List.js',
			'Stdlib_Int.js'
		]);
		const module = { exports: {} as Record<string, unknown> };
		scope[RESCRIPT_RUNTIME_GLOBAL].modules['Stdlib_Int.js'](module.exports, () => null, module);
		expect(module.exports.one).toBe(1);
	});

	it('reproduces the committed manifest and version pin from the checked-in bundle', async () => {
		const tempRoot = await makeTempDir();
		const targetDir = path.join(tempRoot, 'wasm-rescript');
		await cp(staticDir, targetDir, { recursive: true });
		const versionModulePath = path.join(tempRoot, 'wasmReScriptVersion.ts');

		const result = await syncWasmReScriptAssets({ targetDir, versionModulePath });

		for (const file of [
			'runtime-manifest.v1.json',
			'runtime-build.json',
			'compiler.js.gz.bin',
			'LICENSE.txt',
			'runner-worker.js'
		]) {
			const [actual, expected] = await Promise.all([
				readFile(path.join(targetDir, file)),
				readFile(path.join(staticDir, file))
			]);
			expect(actual.equals(expected), file).toBe(true);
		}
		expect(await readFile(versionModulePath, 'utf8')).toBe(
			await readFile(
				path.join(repoRoot, 'src', 'lib', 'playground', 'wasmReScriptVersion.ts'),
				'utf8'
			)
		);
		expect(result.storage.bytes).toBeLessThan(1_400_000);
	}, 30_000);

	it('refuses a checked-in bundle that no longer matches the pinned receipt', async () => {
		const tempRoot = await makeTempDir();
		const targetDir = path.join(tempRoot, 'wasm-rescript');
		await cp(staticDir, targetDir, { recursive: true });
		await writeFile(path.join(targetDir, 'compiler.js.gz.bin'), gzipSync(Buffer.from('x')));

		await expect(
			syncWasmReScriptAssets({
				targetDir,
				versionModulePath: path.join(tempRoot, 'version.ts')
			})
		).rejects.toThrow('does not match the pinned bundle receipt');
	});
});
