import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmNimAssets } from '../../scripts/sync-wasm-nim.mjs';

const tempDirs: string[] = [];
const originalWasmNimSourceDir = process.env.WASM_NIM_SOURCE_DIR;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-nim-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

function makeClangJsFixture() {
	const workerSource =
		'const e={};' +
		'readBuffer:async t=>(await fetch(`${a}/${t}`)).arrayBuffer(),async compileStreaming(t){const e=await fetch(`${a}/${t}`,{cache:"no-store"});return WebAssembly.compile(await e.arrayBuffer())}' +
		'let s,i;let r=null;const n=async t=>{' +
		'case"compile-each-link":{const files=h.files;' +
		'const o=s.memfs.getFileContents(h.out);const inst=await s.hostLogAsync(`Compiling ${h.out}`,WebAssembly.compile(o));const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});' +
		'break;}' +
		'};';
	const encoded = Buffer.from(workerSource, 'utf8').toString('base64');
	return `var a="${encoded}"; export function init() {}`;
}

function decodeClangWorker(clangSource: string) {
	const match = clangSource.match(/a="([A-Za-z0-9+/=]+)"/);
	if (!match) throw new Error('missing worker payload');
	return Buffer.from(match[1], 'base64').toString('utf8');
}

async function writeRuntimeFixture(sourceDir: string) {
	await writeFixtureFile(sourceDir, 'nim/nim-bundle.js', '__NIM_USER_CODE__; callMain();\n');
	await writeFixtureFile(sourceDir, 'nim/nim.wasm', 'nim-wasm');
	await writeFixtureFile(sourceDir, 'nim/nimbase.h', '/* nimbase */\n');
	await writeFixtureFile(sourceDir, 'clang/clang.js', makeClangJsFixture());
	await writeFixtureFile(sourceDir, 'clang/clang.wasm', 'clang-wasm');
	await writeFixtureFile(sourceDir, 'clang/lld.wasm', 'lld-wasm');
	await writeFixtureFile(sourceDir, 'clang/memfs.wasm', 'memfs-wasm');
	await writeFixtureFile(sourceDir, 'clang/sysroot.tar', 'sysroot');
}

describe('syncWasmNimAssets', () => {
	afterEach(async () => {
		if (originalWasmNimSourceDir === undefined) {
			delete process.env.WASM_NIM_SOURCE_DIR;
		} else {
			process.env.WASM_NIM_SOURCE_DIR = originalWasmNimSourceDir;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies Nim wasm compiler assets, patches clang.js, and writes a version module', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmNimVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		await writeRuntimeFixture(sourceDir);

		const result = await syncWasmNimAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'nim/nim-bundle.js'), 'utf8')).resolves.toContain(
			'__NIM_USER_CODE__'
		);
		await expect(readFile(path.join(targetDir, 'clang/clang.wasm'), 'utf8')).resolves.toBe(
			'clang-wasm'
		);
		const clangWorker = decodeClangWorker(
			await readFile(path.join(targetDir, 'clang/clang.js'), 'utf8')
		);
		expect(clangWorker).toContain('fetchAsset(a,t');
		expect(clangWorker).toContain('compile-each-link-done",data:{ok:true}');
		expect(clangWorker).toContain('compile-each-link-done",data:{ok:false,error:String');
		expect(clangWorker).not.toContain('finalResult=await s.run(inst,h.out)');
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; runtime: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-nim-runtime-manifest-v1',
			runtime: 'benagastov-nim-wasm-compiler'
		});
		expect(manifest.files).toContain('nim/nim.wasm');
		expect(manifest.files).toContain('clang/clang.js');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_NIM_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('refreshes the worker and version module from an existing compressed target', async () => {
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmNimVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		await writeFixtureFile(targetDir, 'nim/nim-bundle.js.gz', 'compressed-bundle');
		await writeFixtureFile(targetDir, 'nim/nim.wasm.gz', 'compressed-nim');
		await writeFixtureFile(targetDir, 'nim/nimbase.h', '/* nimbase */');
		await writeFixtureFile(targetDir, 'clang/clang.js', makeClangJsFixture());
		await writeFixtureFile(targetDir, 'clang/clang.wasm.gz', 'compressed-clang');
		await writeFixtureFile(targetDir, 'clang/lld.wasm.gz', 'compressed-lld');
		await writeFixtureFile(targetDir, 'clang/memfs.wasm', 'memfs');
		await writeFixtureFile(targetDir, 'clang/sysroot.tar.gz', 'compressed-sysroot');
		process.env.WASM_NIM_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmNimAssets({ targetDir, workerSourcePath, versionModulePath });

		await expect(readFile(path.join(targetDir, 'nim/nim.wasm.gz'), 'utf8')).resolves.toBe(
			'compressed-nim'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: string[] };
		expect(manifest.files).toContain('nim/nim-bundle.js.gz');
		expect(manifest.files).toContain('clang/sysroot.tar.gz');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});
});
