import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmLispDist } from '../../scripts/sync-wasm-lisp.mjs';

const tempDirs: string[] = [];
const wasmHeader = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-lisp-'));
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

async function writeCompleteDist(sourceDir: string) {
	await writeFixtureFile(sourceDir, 'index.js', 'export const lisp = true;\n');
	await writeFixtureFile(sourceDir, 'puppyc.js', 'export function instantiate() {}\n');
	await writeFixtureFile(sourceDir, 'puppyc.core.wasm', wasmHeader);
	await writeFixtureFile(sourceDir, 'puppyc.core2.wasm', wasmHeader);
	await writeFixtureFile(sourceDir, 'puppyc.component.wasm', wasmHeader);
	await writeFixtureFile(sourceDir, 'runtime-build.json', '{"upstream":"puppy-scheme"}\n');
	await writeFixtureFile(sourceDir, 'index.d.ts', 'export type Ignored = true;\n');
	await writeFixtureFile(
		sourceDir,
		'vendor/jco/src/browser.js',
		'export const generate = true;\n'
	);
	await writeFixtureFile(
		sourceDir,
		'vendor/jco/obj/js-component-bindgen-component.js',
		'export const jco = true;\n'
	);
	await writeFixtureFile(
		sourceDir,
		'vendor/jco/obj/js-component-bindgen-component.core.wasm',
		wasmHeader
	);
	await writeFixtureFile(
		sourceDir,
		'vendor/jco/obj/js-component-bindgen-component.core2.wasm',
		wasmHeader
	);
	await writeFixtureFile(sourceDir, 'vendor/preview2-shim/lib/browser/cli.js', 'export {};\n');
	await writeFixtureFile(
		sourceDir,
		'vendor/preview2-shim/lib/browser/filesystem.js',
		'export {};\n'
	);
	await writeFixtureFile(sourceDir, 'vendor/preview2-shim/lib/browser/io.js', 'export {};\n');
	await writeFixtureFile(
		sourceDir,
		'vendor/preview2-shim/lib/browser/tsconfig.tsbuildinfo',
		'{}'
	);
}

describe('syncWasmLispDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies the built Puppy Scheme compiler runtime into the static directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmLispVersion.ts');
		await writeCompleteDist(sourceDir);

		const result = await syncWasmLispDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'index.js'), 'utf8')).resolves.toContain(
			'lisp = true'
		);
		await expect(readFile(path.join(targetDir, 'puppyc.core2.wasm'))).resolves.toEqual(
			Buffer.from(wasmHeader)
		);
		await expect(
			readFile(
				path.join(targetDir, 'vendor/jco/obj/js-component-bindgen-component.js'),
				'utf8'
			)
		).resolves.toContain('jco = true');
		await expect(readFile(path.join(targetDir, 'index.d.ts'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(
				path.join(targetDir, 'vendor/preview2-shim/lib/browser/tsconfig.tsbuildinfo'),
				'utf8'
			)
		).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_LISP_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('clears stale files from the previous synced bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmLispVersion.ts');
		await writeCompleteDist(sourceDir);
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');

		await syncWasmLispDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).rejects.toThrow();
	});

	it('fails with a build hint when the wasm-lisp dist directory does not exist', async () => {
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmLispVersion.ts');

		await expect(syncWasmLispDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'Build wasm-lisp first'
		);
	});

	it('rejects invalid Puppy compiler wasm assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmLispVersion.ts');
		await writeCompleteDist(sourceDir);
		await writeFixtureFile(sourceDir, 'puppyc.core2.wasm', new Uint8Array([1, 2, 3, 4]));

		await expect(syncWasmLispDist({ sourceDir, targetDir, versionModulePath })).rejects.toThrow(
			'puppyc compiler module'
		);
	});
});
