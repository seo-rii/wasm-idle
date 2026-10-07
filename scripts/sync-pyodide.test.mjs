import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncPyodidePackage } from './sync-pyodide.mjs';

const temporaryDirectories = [];
const version = '314.0.7';
const coreFiles = [
	'ffi.d.ts',
	'package.json',
	'pyodide-lock.json',
	'pyodide.asm.mjs',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.mjs',
	'python_stdlib.zip'
];
const wheelFiles = {
	numpy: 'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
	jedi: 'jedi-0.19.2-py2.py3-none-any.whl',
	parso: 'parso-0.8.6-py2.py3-none-any.whl'
};

function wheelPackage(name, fileName, depends = []) {
	const bytes = Buffer.from(`verified fixture for ${name}`);
	return {
		bytes,
		metadata: {
			name,
			version: '1.0.0',
			file_name: fileName,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			depends
		}
	};
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function fixture() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-pyodide-sync-'));
	temporaryDirectories.push(directory);
	const sourceDir = path.join(directory, 'source');
	const targetDir = path.join(directory, 'target');
	const wheelCacheDir = path.join(directory, 'wheels');
	await mkdir(sourceDir);
	await mkdir(targetDir);
	await mkdir(wheelCacheDir);
	await writeFile(path.join(targetDir, 'keep-until-validated'), 'previous runtime');
	await Promise.all(coreFiles.map((file) => writeFile(path.join(sourceDir, file), file)));
	await writeFile(
		path.join(sourceDir, 'package.json'),
		JSON.stringify({ name: 'pyodide', version, type: 'module' })
	);
	await writeFile(path.join(sourceDir, 'pyodide.mjs'), `export const version = '${version}';`);
	const wheels = Object.fromEntries(
		Object.entries(wheelFiles).map(([name, fileName]) => [
			name,
			wheelPackage(name, fileName, name === 'jedi' ? ['parso'] : [])
		])
	);
	const lock = {
		info: {
			arch: 'wasm32',
			abi_version: '2026_0',
			platform: 'emscripten_5_0_3',
			python: '3.14.2'
		},
		packages: Object.fromEntries(
			Object.entries(wheels).map(([name, wheel]) => [name, wheel.metadata])
		)
	};
	await writeFile(path.join(sourceDir, 'pyodide-lock.json'), JSON.stringify(lock));
	await Promise.all(
		Object.values(wheels).map((wheel) =>
			writeFile(path.join(wheelCacheDir, wheel.metadata.file_name), wheel.bytes)
		)
	);
	return { sourceDir, targetDir, wheelCacheDir, wheels, lock };
}

async function assertPreviousRuntime(targetDir) {
	assert.equal(
		await readFile(path.join(targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
}

async function writeLock(options) {
	await writeFile(
		path.join(options.sourceDir, 'pyodide-lock.json'),
		JSON.stringify(options.lock)
	);
}

test('syncs the ES module runtime with Python and ABI provenance and removes stale assets', async () => {
	const options = await fixture();
	const receipt = await syncPyodidePackage(options);
	assert.equal(receipt.version, version);
	assert.equal(receipt.pythonVersion, '3.14.2');
	assert.equal(receipt.abiVersion, '2026_0');
	assert.deepEqual(receipt.assets, [...coreFiles, ...Object.values(wheelFiles)]);
	assert.deepEqual(
		receipt.wheels.map((wheel) => wheel.name),
		['numpy', 'jedi', 'parso']
	);
	for (const file of coreFiles) {
		assert.deepEqual(
			await readFile(path.join(options.targetDir, file)),
			await readFile(path.join(options.sourceDir, file))
		);
	}
	for (const [name, wheel] of Object.entries(options.wheels)) {
		assert.deepEqual(
			await readFile(path.join(options.targetDir, wheel.metadata.file_name)),
			wheel.bytes
		);
		const provenance = receipt.wheels.find((entry) => entry.name === name);
		assert.equal(provenance.sha256, wheel.metadata.sha256);
		assert.equal(provenance.bytes, wheel.bytes.length);
		assert.equal(provenance.source, 'cache');
	}
	await assert.rejects(readFile(path.join(options.targetDir, 'keep-until-validated')), {
		code: 'ENOENT'
	});
	await assert.rejects(readFile(path.join(options.targetDir, 'pyodide.asm.js')), {
		code: 'ENOENT'
	});
});

test('leaves the previous runtime intact when the ES module is missing', async () => {
	const options = await fixture();
	await rm(path.join(options.sourceDir, 'pyodide.asm.mjs'));
	await assert.rejects(syncPyodidePackage(options), /Required Pyodide asset.*pyodide\.asm\.mjs/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});

test('rejects a package whose entry loader is from a different release before copying', async () => {
	const options = await fixture();
	await writeFile(
		path.join(options.sourceDir, 'pyodide.mjs'),
		"export const version = '0.29.3';"
	);
	await assert.rejects(syncPyodidePackage(options), /package and loader versions do not match/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});

test('accepts the informational lock version independently of the compatible Python and ABI', async () => {
	const options = await fixture();
	const lockPath = path.join(options.sourceDir, 'pyodide-lock.json');
	const lock = JSON.parse(await readFile(lockPath, 'utf8'));
	lock.info.version = '0.28.0.dev0';
	await writeFile(lockPath, JSON.stringify(lock));
	const receipt = await syncPyodidePackage(options);
	assert.equal(receipt.version, version);
	assert.equal(receipt.abiVersion, '2026_0');
});

test('rejects missing Python and ABI compatibility metadata before copying', async () => {
	const options = await fixture();
	await writeFile(
		path.join(options.sourceDir, 'pyodide-lock.json'),
		JSON.stringify({ info: {}, packages: {} })
	);
	await assert.rejects(syncPyodidePackage(options), /invalid Python or ABI metadata/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});

test('includes recursive lock dependencies once when multiple roots share them', async () => {
	const options = await fixture();
	const helper = wheelPackage('helper', 'helper-1.0.0-py3-none-any.whl');
	options.lock.packages.numpy.depends = ['parso'];
	options.lock.packages.parso.depends = ['helper'];
	options.lock.packages.helper = helper.metadata;
	await writeLock(options);
	await writeFile(path.join(options.wheelCacheDir, helper.metadata.file_name), helper.bytes);
	const receipt = await syncPyodidePackage(options);
	assert.deepEqual(
		receipt.wheels.map((wheel) => wheel.name),
		['numpy', 'jedi', 'parso', 'helper']
	);
	assert.deepEqual(
		await readFile(path.join(options.targetDir, helper.metadata.file_name)),
		helper.bytes
	);
	assert.equal(receipt.assets.filter((asset) => asset === wheelFiles.parso).length, 1);
});

test('uses verified cache wheels without accessing the network', async () => {
	const options = await fixture();
	const receipt = await syncPyodidePackage({
		...options,
		fetchImpl() {
			throw new Error('Network access is not expected with a verified wheel cache.');
		}
	});
	assert.equal(receipt.wheels.length, 3);
	assert.ok(receipt.wheels.every((wheel) => wheel.source === 'cache'));
});

test('preserves the previous target if the final transitive wheel is absent from the cache', async () => {
	const options = await fixture();
	await rm(path.join(options.wheelCacheDir, wheelFiles.parso));
	await assert.rejects(syncPyodidePackage(options), /ENOENT/u);
	await assertPreviousRuntime(options.targetDir);
	assert.deepEqual(await readdir(options.targetDir), ['keep-until-validated']);
});

test('rejects a corrupt cached wheel even when the target contains a matching wheel', async () => {
	const options = await fixture();
	await writeFile(path.join(options.targetDir, wheelFiles.parso), options.wheels.parso.bytes);
	await writeFile(path.join(options.wheelCacheDir, wheelFiles.parso), 'stale or corrupt wheel');
	await assert.rejects(syncPyodidePackage(options), /SHA256 mismatch.*parso/u);
	await assertPreviousRuntime(options.targetDir);
	assert.deepEqual(
		await readFile(path.join(options.targetDir, wheelFiles.parso)),
		options.wheels.parso.bytes
	);
});

test('rejects invalid wheel lock metadata before loading wheels or replacing the target', async () => {
	for (const corrupt of [
		(metadata) => {
			metadata.file_name = '../outside.whl';
		},
		(metadata) => {
			metadata.sha256 = 'invalid';
		},
		(metadata) => {
			metadata.depends = 'parso';
		}
	]) {
		const options = await fixture();
		corrupt(options.lock.packages.jedi);
		await writeLock(options);
		await assert.rejects(syncPyodidePackage(options), /invalid wheel metadata.*jedi/u);
		await assertPreviousRuntime(options.targetDir);
	}
});

test('rejects missing transitive dependency metadata before copying', async () => {
	const options = await fixture();
	delete options.lock.packages.parso;
	await writeLock(options);
	await assert.rejects(syncPyodidePackage(options), /invalid wheel metadata.*parso/u);
	await assertPreviousRuntime(options.targetDir);
});

test('downloads exact wheel filenames from the loader release official CDN', async () => {
	const options = await fixture();
	const requests = [];
	const receipt = await syncPyodidePackage({
		...options,
		wheelCacheDir: '',
		fetchImpl: async (url) => {
			requests.push(String(url));
			const wheel = Object.values(options.wheels).find((entry) =>
				String(url).endsWith(entry.metadata.file_name)
			);
			assert.ok(wheel);
			return new Response(wheel.bytes);
		}
	});
	assert.deepEqual(
		requests,
		Object.values(wheelFiles).map(
			(file) => `https://cdn.jsdelivr.net/pyodide/v${version}/full/${file}`
		)
	);
	assert.ok(receipt.wheels.every((wheel) => wheel.source === 'official-cdn'));
});

test('preserves the previous target when the last CDN request fails', async () => {
	const options = await fixture();
	const requests = [];
	await assert.rejects(
		syncPyodidePackage({
			...options,
			wheelCacheDir: '',
			fetchImpl: async (url) => {
				requests.push(String(url));
				const wheel = Object.values(options.wheels).find((entry) =>
					String(url).endsWith(entry.metadata.file_name)
				);
				return new Response(wheel.bytes, {
					status: wheel.metadata.name === 'parso' ? 404 : 200
				});
			}
		}),
		/Failed to download Pyodide wheel.*parso.*404/u
	);
	assert.equal(requests.length, 3);
	await assertPreviousRuntime(options.targetDir);
	assert.deepEqual(await readdir(options.targetDir), ['keep-until-validated']);
});

test('preserves the previous target when a CDN response has the wrong digest', async () => {
	const options = await fixture();
	await assert.rejects(
		syncPyodidePackage({
			...options,
			wheelCacheDir: '',
			fetchImpl: async () => new Response('not the locked wheel')
		}),
		/SHA256 mismatch.*numpy/u
	);
	await assertPreviousRuntime(options.targetDir);
});
