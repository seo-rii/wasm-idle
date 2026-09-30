#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

/** @param {string} sourceDir @param {string} outputPath */
export async function generateTinyGoExecutableLock(sourceDir, outputPath) {
	sourceDir = path.resolve(sourceDir);
	outputPath = path.resolve(outputPath);
	const relativeOutput = path.relative(sourceDir, outputPath);
	if (
		!relativeOutput ||
		(!relativeOutput.startsWith(`..${path.sep}`) &&
			relativeOutput !== '..' &&
			!path.isAbsolute(relativeOutput))
	) {
		throw new Error('TinyGo executable lock output must be outside the source directory');
	}
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
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, serialized);
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
