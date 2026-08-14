// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	computeNimRuntimeFingerprint,
	patchClangJs,
	patchNimLicense,
	syncWasmNimAssets
} from '../../scripts/sync-wasm-nim.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const workerSourcePath = path.join(
	repositoryRoot,
	'scripts',
	'runtime-workers',
	'wasm-nim-runner-worker.js'
);
const productionLockPath = path.join(repositoryRoot, 'scripts', 'wasm-nim-assets.lock.json');
const noticeSourcePath = path.join(repositoryRoot, 'scripts', 'wasm-nim-third-party-notices.md');
const temporaryRoots: string[] = [];
const originalSourceDir = process.env.WASM_NIM_SOURCE_DIR;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type MutableNimInputLock = {
	[key: string]: unknown;
	assets: Array<{
		bytes: number;
		mediaType: string;
		path: string;
		sha256: string;
		sourceBytes: number;
		sourceSha256: string;
	}>;
	components: Record<string, Record<string, unknown>>;
	documentation: { bytes: number; mediaType: string; path: string; sha256: string };
	license: {
		bytes: number;
		path: string;
		sha256: string;
		sourceBytes: number;
		sourceSha256: string;
		spdx: string;
	};
	notices: { bytes: number; mediaType: string; path: string; sha256: string };
};

function makeClangJsFixture() {
	const embeddedWorker =
		'let h={path:"fixture"},a;a=h.path,{' +
		'readBuffer:async t=>(await fetch(`${a}/${t}`)).arrayBuffer(),async compileStreaming(t){const e=await fetch(`${a}/${t}`,{cache:"no-store"});return WebAssembly.compile(await e.arrayBuffer())}' +
		'};' +
		'let s,i;let r=null;const n=async t=>{' +
		'case"compile-each-link":{const files=h.files;' +
		'const o=s.memfs.getFileContents(h.out);const inst=await s.hostLogAsync(`Compiling ${h.out}`,WebAssembly.compile(o));const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});' +
		'break;}' +
		'};';
	const encoded = Buffer.from(embeddedWorker, 'utf8').toString('base64');
	return `var a="${encoded}";var y,m=!1;class o{constructor(l){this.worker={postMessage(){}};const c={};this.worker.postMessage({id:"constructor",payload:{port:c,path:l}},[c]);this.onReady=Promise.resolve()}}async function p({path:l}){m||(y=new o(l||location.origin),await y.onReady,m=!0)}const marker="compile-each-link-done";export{p as init,marker};`;
}

const wasmFixture = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const sysrootFixture = Buffer.alloc(512);
sysrootFixture.write('ustar', 257, 'ascii');
const sourceFiles: Record<string, Buffer> = {
	'nim/nim-bundle.js': Buffer.from('__NIM_USER_CODE__; callMain();\n'),
	'nim/nim.wasm': wasmFixture,
	'nim/nimbase.h': Buffer.from('#define NIM_INTBITS 32\n'),
	'clang/clang.js': Buffer.from(makeClangJsFixture()),
	'clang/clang.wasm': wasmFixture,
	'clang/lld.wasm': wasmFixture,
	'clang/memfs.wasm': wasmFixture,
	'clang/sysroot.tar': sysrootFixture,
	LICENSE: Buffer.from(
		'MIT License\n\nPermission is hereby granted\n\nThis project bundles third-party wasm binaries:\n\n- clang.wasm, lld.wasm, memfs.wasm, sysroot.tar: Copyright (c) Andy Wingo,\n  distributed under the terms of the binji/clang.js project\n  (https://github.com/binji/clang.js).\n'
	),
	'README.md': Buffer.from('Compile and run **Nim 2.2.4** entirely in the browser\n')
};

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'wasm-nim-sync-'));
	temporaryRoots.push(root);
	const sourceDir = path.join(root, 'source');
	for (const [fileName, bytes] of Object.entries(sourceFiles)) {
		const filePath = path.join(sourceDir, fileName);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, bytes);
	}
	const lock = JSON.parse(await readFile(productionLockPath, 'utf8')) as MutableNimInputLock;
	for (const receipt of lock.assets) {
		const sourceBytes = sourceFiles[receipt.path];
		const runtimeBytes =
			receipt.path === 'clang/clang.js'
				? Buffer.from(patchClangJs(sourceBytes.toString('utf8')))
				: sourceBytes;
		receipt.sourceBytes = sourceBytes.byteLength;
		receipt.sourceSha256 = sha256(sourceBytes);
		receipt.bytes = runtimeBytes.byteLength;
		receipt.sha256 = sha256(runtimeBytes);
	}
	const sourceLicense = sourceFiles.LICENSE;
	const derivedLicense = Buffer.from(patchNimLicense(sourceLicense.toString('utf8')));
	lock.license.sourceBytes = sourceLicense.byteLength;
	lock.license.sourceSha256 = sha256(sourceLicense);
	lock.license.bytes = derivedLicense.byteLength;
	lock.license.sha256 = sha256(derivedLicense);
	const documentation = sourceFiles['README.md'];
	lock.documentation.bytes = documentation.byteLength;
	lock.documentation.sha256 = sha256(documentation);
	const notices = await readFile(noticeSourcePath);
	lock.notices.bytes = notices.byteLength;
	lock.notices.sha256 = sha256(notices);
	const lockFilePath = path.join(root, 'wasm-nim-assets.lock.json');
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);
	return {
		root,
		sourceDir,
		targetDir: path.join(root, 'published'),
		versionModulePath: path.join(root, 'wasmNimVersion.ts'),
		lockFilePath
	};
}

async function listFiles(root: string) {
	const files: string[] = [];
	const directories = [root];
	while (directories.length) {
		const directory = directories.pop()!;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) directories.push(entryPath);
			else if (entry.isFile())
				files.push(path.relative(root, entryPath).split(path.sep).join('/'));
		}
	}
	return files.sort();
}

async function publishFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
	return syncWasmNimAssets({
		sourceDir: fixture.sourceDir,
		targetDir: fixture.targetDir,
		versionModulePath: fixture.versionModulePath,
		workerSourcePath,
		lockFilePath: fixture.lockFilePath,
		noticeSourcePath
	});
}

afterEach(async () => {
	if (originalSourceDir === undefined) delete process.env.WASM_NIM_SOURCE_DIR;
	else process.env.WASM_NIM_SOURCE_DIR = originalSourceDir;
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('syncWasmNimAssets', () => {
	it('loads the Nim LLVM contract from wasm-idle', async () => {
		const source = await readFile(path.resolve('scripts', 'sync-wasm-nim.mjs'), 'utf8');

		expect(source).toContain("from './llvm-contracts/nim.mjs'");
		expect(source).not.toMatch(/from\s+['"]@seo-rii\/wasm-llvm/u);
	});

	it('publishes a deterministic exact receipt graph and generated host pins', async () => {
		const fixture = await createFixture();
		const result = await publishFixture(fixture);

		expect(await listFiles(fixture.targetDir)).toEqual([
			'LICENSE',
			'README.md',
			'THIRD_PARTY_NOTICES.md',
			'clang/clang.js',
			'clang/clang.wasm.gz',
			'clang/lld.wasm.gz',
			'clang/memfs.wasm.gz',
			'clang/sysroot.tar.gz',
			'nim/nim-bundle.js.gz',
			'nim/nim.wasm.gz',
			'nim/nimbase.h',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: 'wasm-nim-runtime-manifest-v2',
			runtime: 'benagastov-nim-wasm-compiler',
			fingerprint: result.fingerprint,
			artifact: { kind: 'content-locked-git-archive-prebuilt', verifiedBuildInput: false }
		});
		expect(manifest.assets).toHaveLength(8);
		expect(manifest.storage).toHaveLength(8);
		expect(computeNimRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		const installedLicense = await readFile(path.join(fixture.targetDir, 'LICENSE'), 'utf8');
		expect(installedLicense).toContain('binji/wasm-clang');
		expect(installedLicense).not.toContain('binji/clang.js');
		expect(installedLicense).toContain('THIRD_PARTY_NOTICES.md');
		const installedNotices = await readFile(
			path.join(fixture.targetDir, 'THIRD_PARTY_NOTICES.md'),
			'utf8'
		);
		expect(installedNotices).toContain('wasm-idle modification notice');
		expect(installedNotices).toContain('Apache License');
		expect(installedNotices).toContain('LLVM Exceptions');
		const buildMetadata = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')
		);
		expect(buildMetadata.legalFiles).toEqual([manifest.license, manifest.notices]);
		expect(buildMetadata.transformations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: 'clang/clang.js',
					modificationNotice: 'THIRD_PARTY_NOTICES.md'
				}),
				expect.objectContaining({ path: 'LICENSE' })
			])
		);
		for (const storage of manifest.storage) {
			const stored = await readFile(path.join(fixture.targetDir, storage.path));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const logical = storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
		}
		const worker = await readFile(path.join(fixture.targetDir, 'runner-worker.js'));
		expect(result.workerReceipt).toEqual({
			bytes: worker.byteLength,
			sha256: sha256(worker)
		});
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');
		expect(versionModule).toContain(result.fingerprint);
		expect(versionModule).toContain(result.workerReceipt.sha256);

		const second = await createFixture();
		await publishFixture(second);
		for (const fileName of await listFiles(fixture.targetDir)) {
			expect(await readFile(path.join(second.targetDir, fileName))).toEqual(
				await readFile(path.join(fixture.targetDir, fileName))
			);
		}
	});

	it('regenerates only from a receipt-verified installed target', async () => {
		const fixture = await createFixture();
		const first = await publishFixture(fixture);
		const second = await syncWasmNimAssets({
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			workerSourcePath,
			lockFilePath: fixture.lockFilePath
		});

		expect(second.fingerprint).toBe(first.fingerprint);
		const installedWasm = await readFile(path.join(fixture.targetDir, 'nim/nim.wasm.gz'));
		installedWasm[installedWasm.byteLength - 1] ^= 1;
		await writeFile(path.join(fixture.targetDir, 'nim/nim.wasm.gz'), installedWasm);
		await expect(
			syncWasmNimAssets({
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow(/installed nim\/nim\.wasm/u);
	});

	it('rejects a source receipt mismatch before replacing published outputs', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous pin');
		const wasm = await readFile(path.join(fixture.sourceDir, 'nim/nim.wasm'));
		wasm[wasm.byteLength - 1] ^= 1;
		await writeFile(path.join(fixture.sourceDir, 'nim/nim.wasm'), wasm);

		await expect(publishFixture(fixture)).rejects.toThrow('does not match its receipt');
		expect(await readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).toBe(
			'previous runtime'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous pin');
	});

	it('rejects a third-party notice receipt mismatch', async () => {
		const fixture = await createFixture();
		const corruptNoticePath = path.join(fixture.root, 'THIRD_PARTY_NOTICES.md');
		const notices = await readFile(noticeSourcePath);
		notices[notices.byteLength - 1] ^= 1;
		await writeFile(corruptNoticePath, notices);

		await expect(
			syncWasmNimAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath,
				noticeSourcePath: corruptNoticePath
			})
		).rejects.toThrow('third-party notice source does not match its receipt');
	});

	it.each<[string, (lock: MutableNimInputLock) => void]>([
		['top-level schema extension', (lock) => (lock.unexpected = true)],
		['component provenance drift', (lock) => (lock.components.llvm.revision = '0'.repeat(40))],
		['license mapping drift', (lock) => (lock.license.path = 'OTHER-LICENSE')],
		['notices mapping drift', (lock) => (lock.notices.path = 'OTHER-NOTICES')],
		['duplicate logical asset', (lock) => (lock.assets[1].path = 'nim/nim-bundle.js')]
	])('rejects %s in the input lock', async (_label, mutate) => {
		const fixture = await createFixture();
		const lock = JSON.parse(
			await readFile(fixture.lockFilePath, 'utf8')
		) as MutableNimInputLock;
		mutate(lock);
		await writeFile(fixture.lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);

		await expect(publishFixture(fixture)).rejects.toThrow(/input lock/u);
	});

	it('rejects logical receipts above the producer decompression limit', async () => {
		const fixture = await createFixture();
		const lock = JSON.parse(
			await readFile(fixture.lockFilePath, 'utf8')
		) as MutableNimInputLock;
		lock.assets[0].sourceBytes = 40 * 1024 * 1024 + 1;
		await writeFile(fixture.lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);

		await expect(publishFixture(fixture)).rejects.toThrow('has an invalid byte size');
	});

	it('fails closed when an explicit source environment path is missing', async () => {
		const fixture = await createFixture();
		await publishFixture(fixture);
		process.env.WASM_NIM_SOURCE_DIR = path.join(fixture.root, 'missing-explicit-source');

		await expect(
			syncWasmNimAssets({
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('source assets were not found');
	});

	it('publishes from an immutable source snapshot when inputs change during rename', async () => {
		const fixture = await createFixture();
		const original = await readFile(path.join(fixture.sourceDir, 'nim/nim.wasm'));
		let mutated = false;
		await syncWasmNimAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			workerSourcePath,
			lockFilePath: fixture.lockFilePath,
			renamePath: async (source, target) => {
				if (!mutated) {
					mutated = true;
					await writeFile(
						path.join(fixture.sourceDir, 'nim/nim.wasm'),
						'replacement race'
					);
				}
				await rename(source, target);
			}
		});

		expect(gunzipSync(await readFile(path.join(fixture.targetDir, 'nim/nim.wasm.gz')))).toEqual(
			original
		);
	});

	it('restores both previous outputs when final publication fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous pin');

		await expect(
			syncWasmNimAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath,
				renamePath: async (source, target) => {
					if (target === fixture.versionModulePath && source.includes('.staging-')) {
						throw new Error('fixture final publication failure');
					}
					await rename(source, target);
				}
			})
		).rejects.toThrow('fixture final publication failure');
		expect(await listFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous pin');
	});

	it('rejects source and publication paths that overlap through resolved boundaries', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmNimAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.sourceDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('publication targets must not overlap their inputs');
	});
});
