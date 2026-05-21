import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeRuntimePackEntries(entries) {
	const sortedEntries = [...entries].sort((left, right) =>
		left.runtimePath.localeCompare(right.runtimePath)
	);
	const seenRuntimePaths = new Set();
	return sortedEntries.map((entry, index) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error(`invalid runtime pack entry at index ${index}`);
		}
		if (typeof entry.runtimePath !== 'string' || entry.runtimePath.length === 0) {
			throw new Error(`invalid runtime pack entry runtimePath at index ${index}`);
		}
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(`duplicate runtime pack runtimePath ${entry.runtimePath}`);
		}
		seenRuntimePaths.add(entry.runtimePath);
		if (entry.bytes instanceof Uint8Array) {
			return entry;
		}
		if (typeof entry.sourcePath !== 'string' || entry.sourcePath.length === 0) {
			throw new Error(
				`runtime pack entry ${entry.runtimePath} requires either bytes or sourcePath`
			);
		}
		return entry;
	});
}

export async function buildRuntimePack(entries) {
	const normalizedEntries = normalizeRuntimePackEntries(entries);
	const indexedEntries = [];
	const chunks = [];
	let totalBytes = 0;
	for (const entry of normalizedEntries) {
		const bytes =
			entry.bytes instanceof Uint8Array
				? entry.bytes
				: new Uint8Array(await fs.readFile(entry.sourcePath));
		indexedEntries.push({
			runtimePath: entry.runtimePath,
			offset: totalBytes,
			length: bytes.byteLength
		});
		totalBytes += bytes.byteLength;
		chunks.push(bytes);
	}
	const packBytes = new Uint8Array(totalBytes);
	let cursor = 0;
	for (const chunk of chunks) {
		packBytes.set(chunk, cursor);
		cursor += chunk.byteLength;
	}
	return {
		packBytes,
		index: {
			format: 'wasm-rust-runtime-pack-index-v1',
			fileCount: indexedEntries.length,
			totalBytes,
			entries: indexedEntries
		}
	};
}

export async function writeRuntimePack({ packPath, indexPath, entries }) {
	const { packBytes, index } = await buildRuntimePack(entries);
	await fs.mkdir(path.dirname(packPath), { recursive: true });
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(packPath, packBytes);
	await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');
	return index;
}
