import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmHaskellAssets } from '../../scripts/sync-wasm-haskell.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-haskell-'));
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

describe('syncWasmHaskellAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies and patches the wasm-haskell browser compiler assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmHaskellVersion.ts');

		await writeFixtureFile(
			sourceDir,
			'dyld.mjs',
			`const wasi = await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim");
const fallback = new wasi.PreopenDirectory("/", [["tmp", new wasi.Directory([])]]);
class DyLDBrowserHost {
  // Continuations to output a single line to stdout/stderr
  stdout;
  stderr;

  constructor({ rootfs, stdout, stderr }) {
    this.rootfs = rootfs;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}
class DyLD {
  #rpc;
  constructor({ args, rpc }) {
    this.#rpc = rpc;
    this.#wasi = new wasi.WASI(
      args,
      [],
      [
          new wasi.OpenFile(
            new wasi.File(new Uint8Array(), { readonly: true })
          ),
          wasi.ConsoleStdout.lineBuffered((msg) => this.#rpc.stdout(msg))
      ],
      { debug: false }
    );
  }
}
export { wasi, fallback };
`
		);
		await writeFixtureFile(sourceDir, 'prelude.mjs', 'export const prelude = true;\n');
		await writeFixtureFile(sourceDir, 'post-link.mjs', 'export const postLink = true;\n');
		await writeFixtureFile(
			sourceDir,
			'rootfs.tar.zst',
			new Uint8Array([0x28, 0xb5, 0x2f, 0xfd])
		);
		await writeFixtureFile(sourceDir, 'bsdtar.wasm', new Uint8Array([0, 97, 115, 109, 1]));

		const result = await syncWasmHaskellAssets({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'dyld.mjs'), 'utf8')).resolves.toContain(
			'await import("./browser_wasi_shim/index.js")'
		);
		await expect(readFile(path.join(targetDir, 'dyld.mjs'), 'utf8')).resolves.toContain(
			'new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(new Map())]]))'
		);
		const dyldSource = await readFile(path.join(targetDir, 'dyld.mjs'), 'utf8');
		expect(dyldSource).toContain('constructor({ rootfs, stdout, stderr, stdin })');
		expect(dyldSource).toContain('this.stdin = stdin');
		expect(dyldSource).toContain('this.#rpc instanceof DyLDBrowserHost && this.#rpc.stdin');
		await expect(readFile(path.join(targetDir, 'prelude.mjs'), 'utf8')).resolves.toContain(
			'prelude'
		);
		await expect(readFile(path.join(targetDir, 'post-link.mjs'), 'utf8')).resolves.toContain(
			'postLink'
		);
		await expect(readFile(path.join(targetDir, 'rootfs.tar.zst'))).resolves.toEqual(
			Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
		);
		await expect(readFile(path.join(targetDir, 'bsdtar.wasm'))).resolves.toEqual(
			Buffer.from([0, 97, 115, 109, 1])
		);
		await expect(
			readFile(path.join(targetDir, 'browser_wasi_shim', 'index.js'), 'utf8')
		).resolves.toContain('WASI');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_HASKELL_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('fails when a local source directory is present but incomplete', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmHaskellVersion.ts');

		await writeFixtureFile(sourceDir, 'dyld.mjs', 'export {};\n');

		await expect(
			syncWasmHaskellAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('wasm-haskell asset was not found');
	});

	it('rejects an invalid bsdtar wasm file', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmHaskellVersion.ts');

		await writeFixtureFile(sourceDir, 'dyld.mjs', 'export {};\n');
		await writeFixtureFile(sourceDir, 'prelude.mjs', 'export {};\n');
		await writeFixtureFile(sourceDir, 'post-link.mjs', 'export {};\n');
		await writeFixtureFile(
			sourceDir,
			'rootfs.tar.zst',
			new Uint8Array([0x28, 0xb5, 0x2f, 0xfd])
		);
		await writeFixtureFile(sourceDir, 'bsdtar.wasm', new Uint8Array([1, 2, 3, 4]));

		await expect(
			syncWasmHaskellAssets({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('bsdtar.wasm is not a valid wasm binary');
	});
});
