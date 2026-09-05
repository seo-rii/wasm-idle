import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
	syncWasmTypeScriptDist,
	verifyWasmTypeScriptDist
} from '../../scripts/sync-wasm-typescript.mjs';
import {
	computeWasmTypeScriptSourceReceipt,
	readWasmTypeScriptToolchain,
	writeWasmTypeScriptProducerBuildReceipt
} from '../../runtimes/wasm-typescript/scripts/provenance.mjs';
import {
	WASM_TYPESCRIPT_ASSET_VERSION,
	WASM_TYPESCRIPT_MODULE_RECEIPT
} from './playground/wasmTypeScriptVersion';

const temporaryDirectories: string[] = [];
const repositoryRoot = process.cwd();
const execFileAsync = promisify(execFile);

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-typescript-receipt-'));
	temporaryDirectories.push(root);
	const producerDir = path.join(root, 'runtime');
	const sourceDir = path.join(producerDir, 'dist');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'wasmTypeScriptVersion.ts');
	await mkdir(path.join(producerDir, 'src'), { recursive: true });
	await mkdir(path.join(producerDir, 'scripts'), { recursive: true });
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(producerDir, 'package.json'), '{"name":"fixture"}\n');
	await writeFile(path.join(producerDir, 'tsconfig.json'), '{}\n');
	await writeFile(path.join(producerDir, 'src/index.ts'), 'export const answer = 42;\n');
	await writeFile(path.join(producerDir, 'scripts/build.mjs'), 'export {};\n');
	await writeFile(path.join(producerDir, 'scripts/provenance.mjs'), 'export {};\n');
	for (const [packageName, version] of Object.entries({
		'@swc/wasm-typescript': '1.15.33',
		buffer: '6.0.3',
		esbuild: '0.27.3',
		typescript: '5.9.3'
	})) {
		const packageDir = path.join(producerDir, 'node_modules', ...packageName.split('/'));
		await mkdir(packageDir, { recursive: true });
		await writeFile(
			path.join(packageDir, 'package.json'),
			`${JSON.stringify({ name: packageName, version })}\n`
		);
	}
	return { producerDir, sourceDir, targetDir, versionModulePath };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmTypeScriptDist', () => {
	it('publishes a deterministic logical module receipt and pinned constants', async () => {
		const fixture = await createFixture();
		const moduleSource = 'export const answer = 42;\n';
		const moduleBytes = new TextEncoder().encode(moduleSource);
		const moduleSha256 = createHash('sha256').update(moduleBytes).digest('hex');
		await writeFile(path.join(fixture.sourceDir, 'index.js'), moduleBytes);
		await writeFile(
			path.join(fixture.sourceDir, 'index.d.ts'),
			'export declare const answer = 42;\n'
		);
		await writeWasmTypeScriptProducerBuildReceipt(fixture);

		const first = await syncWasmTypeScriptDist(fixture);
		const receipt = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')
		);
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');

		expect(receipt).toEqual({
			format: 'wasm-typescript-runtime-build-v2',
			fingerprint: first.fingerprint,
			producer: expect.objectContaining({
				format: 'wasm-typescript-producer-build-v1'
			}),
			assets: {
				'index.js': {
					bytes: moduleBytes.byteLength,
					sha256: moduleSha256
				}
			}
		});
		expect(first.moduleReceipt).toEqual(receipt.assets['index.js']);
		expect(versionModule).toContain(
			`export const WASM_TYPESCRIPT_ASSET_VERSION = '${first.fingerprint}';`
		);
		expect(versionModule).toContain(`bytes: ${moduleBytes.byteLength}`);
		expect(versionModule).toContain(`sha256: '${moduleSha256}'`);
		await expect(stat(path.join(fixture.targetDir, 'index.d.ts'))).rejects.toMatchObject({
			code: 'ENOENT'
		});

		await writeFile(path.join(fixture.targetDir, 'runtime-build.json'), '{}\n');
		const second = await syncWasmTypeScriptDist(fixture);
		expect(second).toEqual(first);
		expect(
			JSON.parse(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8'))
		).toEqual(receipt);
		await expect(verifyWasmTypeScriptDist(fixture)).resolves.toMatchObject({
			fingerprint: first.fingerprint,
			moduleReceipt: first.moduleReceipt
		});
	});

	it('rejects a producer output whose source changed after it was built', async () => {
		const fixture = await createFixture();
		await writeFile(path.join(fixture.sourceDir, 'index.js'), 'export const answer = 42;\n');
		await writeWasmTypeScriptProducerBuildReceipt(fixture);
		await writeFile(
			path.join(fixture.producerDir, 'src/index.ts'),
			'export const answer = 43;\n'
		);

		await expect(syncWasmTypeScriptDist(fixture)).rejects.toThrow(
			/producer source receipt does not match the current inputs/u
		);
	});

	it('verifies compressed checked-in delivery bytes without rewriting them', async () => {
		const fixture = await createFixture();
		const modulePath = path.join(fixture.sourceDir, 'index.js');
		const moduleBytes = Buffer.from('export const answer = 42;\n');
		await writeFile(modulePath, moduleBytes);
		await writeWasmTypeScriptProducerBuildReceipt(fixture);
		await syncWasmTypeScriptDist(fixture);

		const installedModulePath = path.join(fixture.targetDir, 'index.js');
		const compressedPath = `${installedModulePath}.gz`;
		await writeFile(
			compressedPath,
			gzipSync(await readFile(installedModulePath), { level: 9 })
		);
		await rm(installedModulePath);

		await expect(verifyWasmTypeScriptDist(fixture)).resolves.toMatchObject({
			moduleReceipt: {
				bytes: moduleBytes.byteLength,
				sha256: createHash('sha256').update(moduleBytes).digest('hex')
			}
		});
		await writeFile(compressedPath, gzipSync(Buffer.from('stale')));
		await expect(verifyWasmTypeScriptDist(fixture)).rejects.toThrow(
			/checked-in module does not match the current producer output/u
		);
	});

	it('uses the workspace lockfile as the sole dependency lock', async () => {
		await expect(
			stat(path.join(repositoryRoot, 'runtimes/wasm-typescript/pnpm-lock.yaml'))
		).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('fails before replacing the target when the entry module is missing', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'keep.txt'), 'keep');

		await expect(syncWasmTypeScriptDist(fixture)).rejects.toThrow(
			'wasm-typescript dist entry was not found'
		);
		expect(await readFile(path.join(fixture.targetDir, 'keep.txt'), 'utf8')).toBe('keep');
	});

	it('pins the checked-in compressed bundle to its logical module receipt', async () => {
		const producerDir = path.join(repositoryRoot, 'runtimes/wasm-typescript');
		const receipt = JSON.parse(
			await readFile(
				path.join(repositoryRoot, 'static/wasm-typescript/runtime-build.json'),
				'utf8'
			)
		);
		const compressed = await readFile(
			path.join(repositoryRoot, 'static/wasm-typescript/index.js.gz')
		);
		const moduleBytes = gunzipSync(compressed);
		const actualReceipt = {
			bytes: moduleBytes.byteLength,
			sha256: createHash('sha256').update(moduleBytes).digest('hex')
		};

		expect(receipt).toEqual({
			format: 'wasm-typescript-runtime-build-v2',
			fingerprint: WASM_TYPESCRIPT_ASSET_VERSION,
			producer: {
				format: 'wasm-typescript-producer-build-v1',
				source: await computeWasmTypeScriptSourceReceipt(producerDir),
				toolchain: await readWasmTypeScriptToolchain(producerDir),
				artifact: {
					path: 'index.js',
					...WASM_TYPESCRIPT_MODULE_RECEIPT
				}
			},
			assets: { 'index.js': WASM_TYPESCRIPT_MODULE_RECEIPT }
		});
		expect(actualReceipt).toEqual(WASM_TYPESCRIPT_MODULE_RECEIPT);
	});

	it('signals readiness from the checked-in runtime before executing the program body', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-typescript-runtime-'));
		temporaryDirectories.push(root);
		const modulePath = path.join(root, 'index.mjs');
		const runnerPath = path.join(root, 'runner.mjs');
		const compressed = await readFile(
			path.join(repositoryRoot, 'static/wasm-typescript/index.js.gz')
		);
		await writeFile(modulePath, gunzipSync(compressed));
		await writeFile(
			runnerPath,
			`import { executeBrowserTypeScriptArtifact } from './index.mjs';
const lifecycle = [];
const execution = await executeBrowserTypeScriptArtifact(
	{
		javascript: 'console.log("body");',
		source: 'console.log("body");',
		language: 'javascript',
		fileName: 'main.js'
	},
	{
		onReady: () => lifecycle.push('ready'),
		stdout: (chunk) => lifecycle.push(chunk.trim())
	}
);
process.stdout.write(JSON.stringify({ execution, lifecycle }));
`,
			'utf8'
		);

		const { stdout } = await execFileAsync(process.execPath, [runnerPath]);
		const result = JSON.parse(stdout);
		expect(result.execution.exitCode).toBe(0);
		expect(result.lifecycle).toEqual(['ready', 'body']);
	});
});
