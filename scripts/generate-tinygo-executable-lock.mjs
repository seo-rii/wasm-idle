#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
	extractTinyGoExecutableImports,
	parseTinyGoExecutableGraphLock
} from './sync-wasm-tinygo.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const BINARY_PATH = /^assets\/upstream-binaryen-[a-f0-9]{16}\.wasm\.gz\.bin$/;
const MAX_BINARY_BYTES = 64 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Resolve existing parent aliases without creating missing output directories. @param {string} directory */
async function resolveOutputParent(directory) {
	let cursor = directory;
	const missing = [];
	for (;;) {
		try {
			await lstat(cursor);
		} catch (error) {
			if (
				!error ||
				typeof error !== 'object' ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			)
				throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) throw error;
			missing.unshift(path.basename(cursor));
			cursor = parent;
			continue;
		}
		// An existing dangling symlink must fail here, not be treated as a missing directory.
		return path.join(await realpath(cursor), ...missing);
	}
}

/** @param {string} sourceDir @param {string} outputPath */
function assertOutputOutsideSource(sourceDir, outputPath) {
	const relativeOutput = path.relative(sourceDir, outputPath);
	if (
		!relativeOutput ||
		(!relativeOutput.startsWith(`..${path.sep}`) &&
			relativeOutput !== '..' &&
			!path.isAbsolute(relativeOutput))
	) {
		throw new Error('TinyGo executable lock output must be outside the source directory');
	}
}

/** @param {string} outputPath */
async function inspectOutputFile(outputPath) {
	let metadata;
	try {
		metadata = await lstat(outputPath);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
			return;
		throw error;
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error('TinyGo graph lock output must be a regular file, not a symlink');
	}
	return metadata;
}

/** @param {string} sourceDir @param {string} outputPath */
export async function generateTinyGoExecutableLock(sourceDir, outputPath) {
	sourceDir = path.resolve(sourceDir);
	const sourceMetadata = await lstat(sourceDir);
	if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink())
		throw new Error('TinyGo graph source directories must not be symlinks');
	sourceDir = await realpath(sourceDir);
	outputPath = path.resolve(outputPath);
	const outputParent = await resolveOutputParent(path.dirname(outputPath));
	outputPath = path.join(outputParent, path.basename(outputPath));
	assertOutputOutsideSource(sourceDir, outputPath);
	await inspectOutputFile(outputPath);
	/** @type {Array<{ path: string; bytes: number; sha256: string; imports: import('./sync-wasm-tinygo.mjs').TinyGoExecutableGraphImport[]; uncompressedBytes?: number; uncompressedSha256?: string }>} */
	const modules = [];
	/** @param {string} relative */
	async function visit(relative) {
		const directory = path.join(sourceDir, relative);
		const metadata = await lstat(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink())
			throw new Error('TinyGo graph source directories must not be symlinks');
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const assetPath = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				await visit(assetPath);
				continue;
			}
			if (!entry.isFile())
				throw new Error(`TinyGo graph contains a non-regular file: ${assetPath}`);
			const binary = BINARY_PATH.test(assetPath);
			if (!assetPath.endsWith('.js') && !binary) {
				if (
					/\.(?:mjs|cjs)$/.test(assetPath) ||
					(assetPath.startsWith('assets/') && /\.(?:wasm(?:\.gz)?|bin)$/.test(assetPath))
				) {
					throw new Error(
						`TinyGo graph contains an unsupported executable asset: ${assetPath}`
					);
				}
				continue;
			}
			const absolute = path.join(sourceDir, assetPath);
			const before = await lstat(absolute);
			if (!before.isFile() || before.isSymbolicLink())
				throw new Error(`TinyGo graph asset is not a regular file: ${assetPath}`);
			const bytes = await readFile(absolute);
			const after = await lstat(absolute);
			if (
				!after.isFile() ||
				before.dev !== after.dev ||
				before.ino !== after.ino ||
				before.size !== after.size ||
				before.mtimeMs !== after.mtimeMs ||
				bytes.length !== before.size
			) {
				throw new Error(`TinyGo graph asset changed while reading: ${assetPath}`);
			}
			const module = {
				path: assetPath,
				bytes: bytes.length,
				sha256: sha256(bytes),
				imports: []
			};
			if (binary) {
				const logical = gunzipSync(bytes, { maxOutputLength: MAX_BINARY_BYTES });
				if (!WebAssembly.validate(logical))
					throw new Error(`Binaryen asset is not valid Wasm: ${assetPath}`);
				modules.push({
					...module,
					uncompressedBytes: logical.length,
					uncompressedSha256: sha256(logical)
				});
			} else {
				const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
				modules.push({
					...module,
					imports: extractTinyGoExecutableImports(source, assetPath)
				});
			}
		}
	}
	await visit('');
	modules.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const lock = {
		format: 'wasm-idle-tinygo-executable-graph-lock-v1',
		entryPath: 'upstream.js',
		modules
	};
	const serialized = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
	// Enforce exact edges, supported receipt fields, reachability and acyclicity
	// before replacing a reviewed lock with freshly generated build evidence.
	parseTinyGoExecutableGraphLock(serialized);
	await mkdir(outputParent, { recursive: true });
	if ((await realpath(outputParent)) !== outputParent)
		throw new Error('TinyGo graph lock output parent changed during generation');
	const previousOutput = await inspectOutputFile(outputPath);
	const temporaryDirectory = await mkdtemp(path.join(outputParent, '.tinygo-graph-lock-'));
	try {
		const temporaryPath = path.join(temporaryDirectory, 'lock.json');
		await writeFile(temporaryPath, serialized, {
			flag: 'wx',
			mode: previousOutput ? previousOutput.mode & 0o777 : 0o666
		});
		// Creation applies the current umask, unlike updating an existing file.
		if (previousOutput) await chmod(temporaryPath, previousOutput.mode & 0o777);
		if ((await realpath(outputParent)) !== outputParent)
			throw new Error('TinyGo graph lock output parent changed during generation');
		await inspectOutputFile(outputPath);
		// Rename replaces the output directory entry; it never truncates an input
		// inode through a hardlink or follows a leaf symlink installed after the check.
		await rename(temporaryPath, outputPath);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
	return lock;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	if (process.argv.length !== 4)
		throw new Error('Usage: generate-tinygo-executable-lock.mjs SOURCE_DIR OUTPUT_FILE');
	generateTinyGoExecutableLock(process.argv[2], process.argv[3]).then(
		(lock) =>
			console.log(
				`Generated ${lock.modules.length} TinyGo graph receipts: ${process.argv[3]}`
			),
		(error) => {
			console.error(error);
			process.exitCode = 1;
		}
	);
}
