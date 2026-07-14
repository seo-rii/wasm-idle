import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	buildRuntimePackReference,
	copyBrowserVendorAssets,
	copyFileIfNeeded,
	ensureDirectory,
	maybePrecompressRuntimeAsset,
	patchRustcMemoryMaximum,
	runtimeRoot
} from './prepare-runtime.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(projectRoot, 'producer-lock.json');
const producerOutputRoot = process.env.WASM_RUST_PRODUCER_OUTPUT_ROOT
	? path.resolve(process.env.WASM_RUST_PRODUCER_OUTPUT_ROOT)
	: '';
const targetTriples = ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'];
const isDirectExecution = process.argv[1]
	? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
	: false;

async function sha256File(filePath) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest('hex');
}

async function listRegularFiles(root, current = root) {
	const entries = await fs.readdir(current, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0
	)) {
		const entryPath = path.join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await listRegularFiles(root, entryPath)));
		else if (entry.isFile())
			files.push(path.relative(root, entryPath).split(path.sep).join('/'));
		else throw new Error(`producer output contains a non-regular file: ${entryPath}`);
	}
	return files;
}

function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stable(value[key])])
		);
	}
	return value;
}

export async function verifyProducerOutput(outputRoot, lock) {
	const receiptPath = path.join(outputRoot, 'producer-receipt.json');
	const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
	if (
		receipt.schemaVersion !== 1 ||
		receipt.producerId !== lock.producerId ||
		receipt.manifestSha256 !== lock.manifestSha256 ||
		receipt.sourceDateEpoch !== lock.sourceDateEpoch ||
		(receipt.runner !== 'host' && receipt.runner !== 'container')
	) {
		throw new Error('producer receipt does not match producer-lock.json');
	}
	if (
		JSON.stringify(stable(receipt.environment)) !== JSON.stringify(stable(lock.environment)) ||
		JSON.stringify(stable(receipt.hostTools)) !== JSON.stringify(stable(lock.hostTools))
	) {
		throw new Error('producer receipt environment does not match producer-lock.json');
	}
	for (const [name, expected] of Object.entries(lock.sources)) {
		const actual = receipt.sources?.[name];
		for (const field of ['commit', 'tree', 'patchedTree', 'patchSha256']) {
			if (actual?.[field] !== expected[field]) {
				throw new Error(`producer receipt source mismatch: ${name}.${field}`);
			}
		}
		if (
			JSON.stringify(stable(actual?.submodules || [])) !==
			JSON.stringify(stable(expected.submodules || []))
		) {
			throw new Error(`producer receipt source mismatch: ${name}.submodules`);
		}
	}

	const receiptPaths = [];
	const seenPaths = new Set();
	for (const asset of receipt.assets || []) {
		if (
			typeof asset.path !== 'string' ||
			path.posix.isAbsolute(asset.path) ||
			asset.path.split('/').includes('..') ||
			seenPaths.has(asset.path)
		) {
			throw new Error(`invalid producer receipt asset path: ${String(asset.path)}`);
		}
		seenPaths.add(asset.path);
		receiptPaths.push(asset.path);
		const assetPath = path.join(outputRoot, asset.path);
		const stat = await fs.stat(assetPath);
		if (stat.size !== asset.size || (await sha256File(assetPath)) !== asset.sha256) {
			throw new Error(`producer asset hash mismatch: ${asset.path}`);
		}
	}
	const actualPaths = (await listRegularFiles(outputRoot)).filter(
		(relativePath) => relativePath !== 'producer-receipt.json'
	);
	if (JSON.stringify(receiptPaths) !== JSON.stringify(actualPaths)) {
		throw new Error('producer receipt does not cover the exact output file set');
	}
	for (const requiredPath of [
		'rust/bin/rustc.wasm',
		...targetTriples.map((targetTriple) => `rust/lib/rustlib/${targetTriple}/lib`)
	]) {
		await fs.access(path.join(outputRoot, requiredPath));
	}
	return receipt;
}

async function main() {
	if (!producerOutputRoot) {
		throw new Error('WASM_RUST_PRODUCER_OUTPUT_ROOT must point to a wasm-llvm producer output');
	}
	const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
	const receipt = await verifyProducerOutput(producerOutputRoot, lock);

	await copyBrowserVendorAssets();
	await fs.rm(runtimeRoot, { recursive: true, force: true });
	await ensureDirectory(runtimeRoot);

	const rustcTargetPath = path.join(runtimeRoot, 'rustc', 'rustc.wasm');
	await copyFileIfNeeded(
		path.join(producerOutputRoot, 'rust', 'bin', 'rustc.wasm'),
		rustcTargetPath
	);
	await patchRustcMemoryMaximum(rustcTargetPath);
	const rustcWasm = await maybePrecompressRuntimeAsset(rustcTargetPath, 'rustc');

	const targets = {};
	for (const targetTriple of targetTriples) {
		const sourceRoot = path.join(
			producerOutputRoot,
			'rust',
			'lib',
			'rustlib',
			targetTriple,
			'lib'
		);
		const sourceFiles = (await listRegularFiles(sourceRoot)).map((relativePath) => ({
			sourcePath: path.join(sourceRoot, relativePath),
			runtimePath: `/lib/rustlib/${targetTriple}/lib/${relativePath}`
		}));
		if (sourceFiles.length === 0) {
			throw new Error(`producer target sysroot is empty: ${targetTriple}`);
		}
		const sysrootPack = await buildRuntimePackReference({
			packAsset: `packs/sysroot/${targetTriple}.pack`,
			indexAsset: `packs/sysroot/${targetTriple}.index.json`,
			entries: sourceFiles
		});
		const componentTarget = targetTriple !== 'wasm32-wasip1';
		targets[targetTriple] = {
			artifactFormat: componentTarget ? 'component' : 'core-wasm',
			sysrootPack,
			compile: {
				kind: componentTarget ? 'integrated-rustc+component-encoder' : 'integrated-rustc'
			},
			execution: {
				kind: componentTarget ? 'preview2-component' : 'preview1'
			}
		};
	}

	await fs.writeFile(
		path.join(runtimeRoot, 'runtime-manifest.v3.json'),
		JSON.stringify(
			{
				manifestVersion: 3,
				version: lock.runtimeVersion,
				hostTriple: 'wasm32-wasip1-threads',
				defaultTargetTriple: 'wasm32-wasip1',
				producer: {
					id: receipt.producerId,
					manifestSha256: receipt.manifestSha256,
					runner: receipt.runner,
					sourceDateEpoch: receipt.sourceDateEpoch
				},
				compiler: {
					rustcWasm,
					workerBitcodeFile: 'main.wasm',
					workerSharedOutputBytes: 64 * 1024 * 1024,
					workerSharedWorkspaceBytes: 128 * 1024 * 1024,
					compileTimeoutMs: 180_000,
					artifactIdleMs: 1_500,
					rustcMemory: {
						initialPages: 6_400,
						maximumPages: 65_536
					}
				},
				targets
			},
			null,
			2
		) + '\n'
	);
}

if (isDirectExecution) await main();
