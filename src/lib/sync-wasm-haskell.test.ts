import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	assertNonOverlappingHaskellPaths,
	buildHaskellModuleBundle,
	haskellPackageTreeReceipt,
	patchHaskellDyldSource,
	readPinnedHaskellResponse,
	syncWasmHaskellAssets,
	updateHaskellCompressedAssetManifest,
	validateHaskellRuntimePublication
} from '../../scripts/sync-wasm-haskell.mjs';

const tempDirs: string[] = [];
const repoRoot = process.cwd();
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

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

const dyldFixture = `import { prelude } from "./prelude.mjs";
import { postLink } from "./post-link.mjs";
const wasi = await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim");
const fallback = new wasi.PreopenDirectory("/", [["tmp", new wasi.Directory([])]]);
const secondFallback = new wasi.PreopenDirectory("/", [["tmp", new wasi.Directory([])]]);

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

class DyLDHost {}
class DyLDRPC {}

class DyLD {
  #rpc;
  #wasi;

  constructor({ args = [], rpc }) {
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

async function main() {
  if (globalThis.__wasmIdleNodeProbe) {
    await Promise.all([
      import("node:fs/promises"),
      import("node:module"),
      import("node:path"),
      import("node:timers"),
      import("node:util")
    ]);
  }
  return { DyLD, fallback, secondFallback, postLink, prelude };
}

export { DyLDBrowserHost, DyLDHost, DyLDRPC, main };
`;

async function writeSourceFixture(sourceDir: string) {
	await writeFixtureFile(sourceDir, 'dyld.mjs', dyldFixture);
	await writeFixtureFile(
		sourceDir,
		'prelude.mjs',
		`import * as debug from './browser_wasi_shim/debug.js';
import * as fd from './browser_wasi_shim/fd.js';
import * as fsMem from './browser_wasi_shim/fs_mem.js';
import * as fsOpfs from './browser_wasi_shim/fs_opfs.js';
import * as index from './browser_wasi_shim/index.js';
import * as strace from './browser_wasi_shim/strace.js';
import * as wasi from './browser_wasi_shim/wasi.js';
import * as wasiDefs from './browser_wasi_shim/wasi_defs.js';
export const prelude = [debug, fd, fsMem, fsOpfs, index, strace, wasi, wasiDefs];
`
	);
	await writeFixtureFile(
		sourceDir,
		'post-link.mjs',
		'globalThis.__wasmIdlePostLinkFixture = true;\nexport const postLink = globalThis.__wasmIdlePostLinkFixture;\n'
	);
	await writeFixtureFile(
		sourceDir,
		'rootfs.tar.zst',
		new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4])
	);
	await writeFixtureFile(sourceDir, 'bsdtar.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
}

async function receipt(filePath: string) {
	const bytes = await readFile(filePath);
	return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}

describe('syncWasmHaskellAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('applies exactly the five browser/stdin compatibility seams', () => {
		const patched = patchHaskellDyldSource(dyldFixture);
		expect(patched).toContain('await import("./browser_wasi_shim/index.js")');
		expect(patched).toContain(
			'new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(new Map())]]))'
		);
		expect(patched).toContain('constructor({ rootfs, stdout, stderr, stdin })');
		expect(patched).toContain('this.stdin = stdin');
		expect(patched).toContain('this.#rpc instanceof DyLDBrowserHost && this.#rpc.stdin');
		expect(() => patchHaskellDyldSource(dyldFixture.replace('  stderr;\n', ''))).toThrow(
			'patch anchor must occur exactly'
		);
	});

	it('produces the same self-contained module from two independent build directories', async () => {
		const sourceDir = await makeTempDir();
		const firstOutput = await makeTempDir();
		const secondOutput = await makeTempDir();
		await writeSourceFixture(sourceDir);

		const [first, second] = await Promise.all([
			buildHaskellModuleBundle({
				sourceDir,
				shimPackageDir: path.join(repoRoot, 'node_modules/@bjorn3/browser_wasi_shim'),
				outDir: firstOutput
			}),
			buildHaskellModuleBundle({
				sourceDir,
				shimPackageDir: path.join(repoRoot, 'node_modules/@bjorn3/browser_wasi_shim'),
				outDir: secondOutput
			})
		]);

		expect(Buffer.from(first)).toEqual(Buffer.from(second));
		const source = new TextDecoder().decode(first);
		expect(source).not.toContain('/tmp/wasm-idle-haskell-bundle-');
		expect(source).not.toContain('./browser_wasi_shim/');
		expect(source).not.toContain('./prelude.mjs');
		expect(source).not.toContain('./post-link.mjs');
	}, 15_000);

	it('excludes install-generated node_modules shims from package tree receipts', async () => {
		const firstPackage = await makeTempDir();
		const secondPackage = await makeTempDir();
		for (const packageDir of [firstPackage, secondPackage]) {
			await writeFixtureFile(packageDir, 'package.json', '{"name":"fixture"}\n');
		}
		await writeFixtureFile(
			firstPackage,
			'node_modules/.bin/tool',
			`#!/bin/sh\nexec ${firstPackage}/tool "$@"\n`
		);
		await writeFixtureFile(
			secondPackage,
			'node_modules/.bin/tool',
			`#!/bin/sh\nexec ${secondPackage}/tool "$@"\n`
		);

		await expect(haskellPackageTreeReceipt(firstPackage)).resolves.toEqual(
			await haskellPackageTreeReceipt(secondPackage)
		);
	});

	it('bounds chunked downloads and handles an encoded transport length separately', async () => {
		const oversized = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3]));
					controller.enqueue(new Uint8Array([4, 5, 6]));
					controller.close();
				}
			})
		);
		await expect(
			readPinnedHaskellResponse(oversized, 4, 'fixture asset', new AbortController().signal)
		).rejects.toThrow('exceeded its locked byte size');

		const decoded = new Uint8Array([1, 2, 3, 4]);
		const encoded = new Response(decoded, {
			headers: { 'content-encoding': 'gzip', 'content-length': '2' }
		});
		await expect(
			readPinnedHaskellResponse(
				encoded,
				decoded.byteLength,
				'encoded fixture',
				new AbortController().signal
			)
		).resolves.toEqual(Buffer.from(decoded));
	});

	it('updates only the exact global Haskell compression contract and rejects overlapping paths', () => {
		const updated = JSON.parse(
			updateHaskellCompressedAssetManifest(
				JSON.stringify({
					assets: ['other.bin', 'wasm-haskell/bsdtar.wasm'],
					sizes: { 'other.bin': 7, 'wasm-haskell/bsdtar.wasm': 1 }
				}),
				8
			)
		);
		expect(updated).toEqual({
			assets: ['other.bin', 'wasm-haskell/bsdtar.wasm'],
			sizes: { 'other.bin': 7, 'wasm-haskell/bsdtar.wasm': 8 }
		});
		expect(() =>
			assertNonOverlappingHaskellPaths([
				['runtime', '/tmp/runtime'],
				['generated', '/tmp/runtime/generated.ts']
			])
		).toThrow('paths overlap');
	});

	it('publishes one receipt-backed graph and rolls every target back after a late rename failure', async () => {
		const sourceDir = await makeTempDir();
		const bundleOutput = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const metadataDir = await makeTempDir();
		const generatedModulePath = path.join(metadataDir, 'haskell-runtime.generated.ts');
		const versionModulePath = path.join(metadataDir, 'wasmHaskellVersion.ts');
		const compressedManifestPath = path.join(metadataDir, 'compressed-runtime-assets.v1.json');
		const lockFilePath = path.join(metadataDir, 'wasm-haskell-assets.lock.json');
		await writeSourceFixture(sourceDir);
		const bundle = await buildHaskellModuleBundle({
			sourceDir,
			shimPackageDir: path.join(repoRoot, 'node_modules/@bjorn3/browser_wasi_shim'),
			outDir: bundleOutput
		});

		const lock = JSON.parse(
			await readFile(path.join(repoRoot, 'scripts/wasm-haskell-assets.lock.json'), 'utf8')
		);
		const localReceipts = Object.fromEntries(
			await Promise.all(
				['dyld.mjs', 'prelude.mjs', 'post-link.mjs', 'rootfs.tar.zst', 'bsdtar.wasm'].map(
					async (asset) => [asset, await receipt(path.join(sourceDir, asset))]
				)
			)
		);
		for (const descriptor of lock.upstream.ghcInBrowser.assets) {
			Object.assign(descriptor, localReceipts[descriptor.path]);
		}
		Object.assign(lock.upstream.bsdtar.asset, localReceipts['bsdtar.wasm']);
		lock.outputs = [
			{
				path: 'dyld.mjs',
				mediaType: 'text/javascript',
				bytes: bundle.byteLength,
				sha256: sha256(bundle)
			},
			{
				path: 'rootfs.tar.zst',
				mediaType: 'application/zstd',
				...localReceipts['rootfs.tar.zst']
			},
			{
				path: 'bsdtar.wasm',
				mediaType: 'application/wasm',
				...localReceipts['bsdtar.wasm']
			}
		];
		await writeFile(lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);
		await writeFile(
			compressedManifestPath,
			`${JSON.stringify(
				{
					assets: ['other.bin', 'wasm-haskell/bsdtar.wasm'],
					sizes: { 'other.bin': 7, 'wasm-haskell/bsdtar.wasm': 1 }
				},
				null,
				2
			)}\n`
		);

		const options = {
			sourceDir,
			targetDir,
			generatedModulePath,
			versionModulePath,
			compressedManifestPath,
			lockFilePath
		};
		const result = await syncWasmHaskellAssets(options);
		const manifest = (await validateHaskellRuntimePublication(targetDir)) as {
			fingerprint: string;
		};
		expect(manifest.fingerprint).toBe(result.fingerprint);
		await expect(readFile(generatedModulePath, 'utf8')).resolves.toContain(result.fingerprint);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe(
			`export const WASM_HASKELL_ASSET_VERSION =\n\t'${result.fingerprint}';\n`
		);
		expect(JSON.parse(await readFile(compressedManifestPath, 'utf8'))).toEqual({
			assets: ['other.bin', 'wasm-haskell/bsdtar.wasm'],
			sizes: { 'other.bin': 7, 'wasm-haskell/bsdtar.wasm': 8 }
		});
		const legacyManifestPath = path.join(targetDir, 'runtime-manifest.v1.json');
		const legacyManifestText = await readFile(legacyManifestPath, 'utf8');
		const legacyManifest = JSON.parse(legacyManifestText);
		await writeFile(
			legacyManifestPath,
			`${JSON.stringify({ ...legacyManifest, unexpected: true }, null, 2)}\n`
		);
		await expect(validateHaskellRuntimePublication(targetDir)).rejects.toThrow(
			'legacy manifest does not match'
		);
		await writeFile(
			legacyManifestPath,
			`${JSON.stringify(
				{
					...legacyManifest,
					packages: { ...legacyManifest.packages, unexpected: '1.0.0' }
				},
				null,
				2
			)}\n`
		);
		await expect(validateHaskellRuntimePublication(targetDir)).rejects.toThrow(
			'legacy manifest does not match'
		);
		await writeFile(legacyManifestPath, legacyManifestText);

		const originalManifest = await readFile(path.join(targetDir, 'runtime-manifest.v2.json'));
		await writeFile(generatedModulePath, 'generated sentinel\n');
		await writeFile(versionModulePath, 'version sentinel\n');
		const compressedBeforeFailure = {
			assets: ['other.bin', 'wasm-haskell/bsdtar.wasm'],
			sizes: { 'other.bin': 7, 'wasm-haskell/bsdtar.wasm': 999 }
		};
		await writeFile(
			compressedManifestPath,
			`${JSON.stringify(compressedBeforeFailure, null, 2)}\n`
		);
		let renameCount = 0;
		await expect(
			syncWasmHaskellAssets({
				...options,
				async renamePath(sourcePath, targetPath) {
					renameCount += 1;
					if (renameCount === 8) throw new Error('injected late publication failure');
					await rename(sourcePath, targetPath);
				}
			})
		).rejects.toThrow('injected late publication failure');

		await expect(readFile(path.join(targetDir, 'runtime-manifest.v2.json'))).resolves.toEqual(
			originalManifest
		);
		await expect(readFile(generatedModulePath, 'utf8')).resolves.toBe('generated sentinel\n');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('version sentinel\n');
		expect(JSON.parse(await readFile(compressedManifestPath, 'utf8'))).toEqual(
			compressedBeforeFailure
		);
	}, 30_000);
});
