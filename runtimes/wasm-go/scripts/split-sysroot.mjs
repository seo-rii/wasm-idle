import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeCopyLiteralDelta } from '../../../scripts/build-layered-runtime-assets.mjs';

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const MAX_OTHER_CHUNK_BYTES = 8 * 1024 * 1024;

function assetPath(runtimeDir, asset) {
	if (
		typeof asset !== 'string' ||
		asset.includes('\\') ||
		path.isAbsolute(asset) ||
		asset.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`unsafe Go sysroot asset path: ${asset}`);
	}
	return path.join(runtimeDir, asset);
}

async function readBundle(runtimeDir, reference) {
	const [compressed, compressedIndex] = await Promise.all([
		readFile(assetPath(runtimeDir, reference.asset)),
		readFile(assetPath(runtimeDir, reference.index))
	]);
	const bytes = gunzipSync(compressed);
	const indexBytes = gunzipSync(compressedIndex);
	const index = JSON.parse(indexBytes);
	if (reference.sha256 && digest(bytes) !== reference.sha256)
		throw new Error('Go sysroot pack SHA-256 mismatch');
	if (reference.indexSha256 && digest(indexBytes) !== reference.indexSha256)
		throw new Error('Go sysroot index SHA-256 mismatch');
	if (
		!Array.isArray(index.entries) ||
		index.entries.length !== reference.fileCount ||
		index.fileCount !== reference.fileCount ||
		index.totalBytes !== bytes.length ||
		reference.totalBytes !== bytes.length
	) {
		throw new Error('Go sysroot pack size differs from its manifest');
	}
	const entries = new Map();
	for (const entry of index.entries) {
		if (
			typeof entry.runtimePath !== 'string' ||
			!entry.runtimePath.startsWith('/sysroot/') ||
			entries.has(entry.runtimePath) ||
			!Number.isSafeInteger(entry.offset) ||
			!Number.isSafeInteger(entry.length) ||
			entry.offset < 0 ||
			entry.length < 0 ||
			entry.offset > bytes.length - entry.length
		) {
			throw new Error('Go sysroot pack has an invalid entry');
		}
		entries.set(entry.runtimePath, {
			...entry,
			bytes: bytes.subarray(entry.offset, entry.offset + entry.length)
		});
	}
	return { reference, index, entries };
}

function closurePaths(stdlibIndex, imports) {
	const packages = new Map(stdlibIndex.packages.map((entry) => [entry.importPath, entry]));
	const paths = new Set();
	const visited = new Set();
	const pending = [...imports];
	while (pending.length) {
		const name = pending.pop();
		if (visited.has(name)) continue;
		visited.add(name);
		const entry = packages.get(name);
		if (!entry) continue;
		paths.add(entry.runtimePath);
		pending.push(...entry.imports);
	}
	return [...paths].sort(compare);
}

/** Repackage existing compiler outputs; no compiler/toolchain build is needed. */
export async function splitGoSysrootPacks(runtimeDir) {
	const manifestPath = path.join(runtimeDir, 'runtime-manifest.v1.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const baseTarget = manifest.targets?.['wasip1/wasm'];
	if (!baseTarget?.sysrootPack || !baseTarget.stdlibIndex || baseTarget.sysrootChunks)
		return { changed: false };
	const base = await readBundle(runtimeDir, baseTarget.sysrootPack);
	if (base.index.format !== 'wasm-go-runtime-pack-index-v1')
		throw new Error('Go chunk base must be an identity sysroot pack');
	const stdlibIndex = JSON.parse(
		gunzipSync(await readFile(assetPath(runtimeDir, baseTarget.stdlibIndex.asset)))
	);
	const groups = [];
	const assigned = new Set();
	// Keep the compulsory runtime and the common console-I/O closure separate.
	// Remaining packages are deterministic bounded packs, never hundreds of requests.
	for (const imports of [['runtime'], ['fmt', 'bufio', 'os']]) {
		const paths = closurePaths(stdlibIndex, imports).filter(
			(name) => base.entries.has(name) && !assigned.has(name)
		);
		if (paths.length) groups.push(paths);
		for (const name of paths) assigned.add(name);
	}
	let pending = [];
	let pendingBytes = 0;
	for (const name of [...base.entries.keys()].sort(compare)) {
		if (assigned.has(name)) continue;
		const size = base.entries.get(name).length;
		if (pending.length && pendingBytes + size > MAX_OTHER_CHUNK_BYTES) {
			groups.push(pending);
			pending = [];
			pendingBytes = 0;
		}
		pending.push(name);
		pendingBytes += size;
	}
	if (pending.length) groups.push(pending);

	const jsTarget = manifest.targets['js/wasm'];
	let js = jsTarget?.sysrootPack ? await readBundle(runtimeDir, jsTarget.sysrootPack) : null;
	if (
		js &&
		js.index.format !== 'wasm-go-runtime-pack-index-v1' &&
		js.index.format !== 'wasm-go-runtime-delta-pack-index-v1'
	) {
		throw new Error('unsupported Go JS sysroot pack format');
	}
	if (js?.index.format === 'wasm-go-runtime-delta-pack-index-v1') {
		if (js.reference.delta?.format !== 'copy-literal-v1') {
			throw new Error('Go JS delta requires a copy-literal-v1 base reference');
		}
		if (
			js.reference.delta.base.asset !== base.reference.asset ||
			js.reference.delta.base.index !== base.reference.index
		) {
			// Custom distributions may use a separate or nested delta base. Keep the
			// existing JS pack and its recursively retained bases while splitting WASI.
			js = null;
		}
	}
	const extraJsPaths = js
		? [...js.entries.keys()].filter((name) => !base.entries.has(name)).sort(compare)
		: [];
	if (extraJsPaths.length) groups.push(extraJsPaths);
	const outputs = [];
	const baseChunks = [];
	const jsChunks = [];
	const emit = (name, paths, entries, baseReference) => {
		let offset = 0;
		let decodedTotalBytes = 0;
		const pieces = [];
		const indexEntries = paths.map((runtimePath) => {
			const entry = entries.get(runtimePath);
			let bytes = entry.bytes;
			const delta = baseReference !== undefined;
			if (delta && js.index.format === 'wasm-go-runtime-pack-index-v1') {
				bytes = encodeCopyLiteralDelta(
					base.entries.get(runtimePath)?.bytes ?? Buffer.alloc(0),
					bytes
				);
			}
			const decodedLength = delta ? (entry.decodedLength ?? entry.length) : entry.length;
			const baseRuntimePath =
				delta && js.index.format === 'wasm-go-runtime-delta-pack-index-v1'
					? entry.baseRuntimePath
					: base.entries.has(runtimePath)
						? runtimePath
						: undefined;
			const indexEntry = {
				runtimePath,
				offset,
				length: bytes.length,
				...(delta
					? {
							decodedLength,
							...(baseRuntimePath !== undefined ? { baseRuntimePath } : {})
						}
					: {})
			};
			offset += bytes.length;
			decodedTotalBytes += decodedLength;
			pieces.push(bytes);
			return indexEntry;
		});
		const bytes = Buffer.concat(pieces, offset);
		const indexBytes = jsonBytes({
			format: baseReference
				? 'wasm-go-runtime-delta-pack-index-v1'
				: 'wasm-go-runtime-pack-index-v1',
			fileCount: paths.length,
			totalBytes: offset,
			...(baseReference ? { decodedTotalBytes } : {}),
			entries: indexEntries
		});
		const reference = {
			asset: `sysroot/chunks/${name}.pack.gz`,
			index: `sysroot/chunks/${name}.index.json.gz`,
			fileCount: paths.length,
			totalBytes: offset,
			sha256: digest(bytes),
			indexSha256: digest(indexBytes),
			...(baseReference
				? { decodedTotalBytes, delta: { format: 'copy-literal-v1', base: baseReference } }
				: {})
		};
		outputs.push(
			[reference.asset, gzipSync(bytes, { level: 9 })],
			[reference.index, gzipSync(indexBytes, { level: 9 })]
		);
		return reference;
	};
	for (const [index, names] of groups.entries()) {
		const id = String(index).padStart(2, '0');
		const basePaths = names.filter((name) => base.entries.has(name));
		const baseReference = emit(`wasip1-${id}`, basePaths, base.entries);
		if (basePaths.length) baseChunks.push({ ...baseReference, runtimePaths: basePaths });
		if (js) {
			const jsPaths = names.filter((name) => js.entries.has(name));
			if (jsPaths.length) {
				let jsBaseReference = baseReference;
				if (js.index.format === 'wasm-go-runtime-delta-pack-index-v1') {
					const referencedPaths = [
						...new Set(
							jsPaths.map((name) => js.entries.get(name).baseRuntimePath ?? name)
						)
					]
						.filter((name) => base.entries.has(name))
						.sort(compare);
					if (referencedPaths.some((name) => !basePaths.includes(name))) {
						jsBaseReference = emit(`wasip1-js-${id}`, referencedPaths, base.entries);
					}
				}
				jsChunks.push({
					...emit(`js-${id}`, jsPaths, js.entries, jsBaseReference),
					runtimePaths: jsPaths
				});
			}
		}
	}
	const removed = new Set();
	for (const target of Object.values(manifest.targets)) {
		if (
			target.sysrootPack?.asset === base.reference.asset &&
			target.sysrootPack?.index === base.reference.index
		) {
			removed.add(target.sysrootPack.asset);
			removed.add(target.sysrootPack.index);
			target.sysrootChunks = baseChunks;
			delete target.sysrootPack;
		}
	}
	if (js) {
		removed.add(js.reference.asset);
		removed.add(js.reference.index);
		jsTarget.sysrootChunks = jsChunks;
		delete jsTarget.sysrootPack;
	}
	await mkdir(path.join(runtimeDir, 'sysroot', 'chunks'), { recursive: true });
	for (const [asset, bytes] of outputs) await writeFile(assetPath(runtimeDir, asset), bytes);
	await writeFile(`${manifestPath}.tmp`, jsonBytes(manifest));
	await rename(`${manifestPath}.tmp`, manifestPath);
	// A custom target may still reference a legacy base pack. Keep any such assets.
	const retained = new Set();
	const retain = (reference) => {
		if (!reference) return;
		retained.add(reference.asset);
		retained.add(reference.index);
		retain(reference.delta?.base);
	};
	for (const target of Object.values(manifest.targets)) {
		retain(target.sysrootPack);
		for (const chunk of target.sysrootChunks ?? []) retain(chunk);
	}
	for (const asset of removed) {
		if (!retained.has(asset)) await rm(assetPath(runtimeDir, asset));
	}
	const buildPath = path.join(runtimeDir, 'runtime-build.json');
	const build = JSON.parse(await readFile(buildPath, 'utf8').catch(() => '{}'));
	build.outputs ??= {};
	build.outputs.sysroots = Object.fromEntries(
		Object.entries(manifest.targets).map(([target, value]) => [
			target,
			{
				...(value.sysrootPack
					? {
							packGzip: value.sysrootPack.asset,
							indexGzip: value.sysrootPack.index
						}
					: {}),
				chunks: value.sysrootChunks?.map(({ asset, index }) => ({ asset, index })),
				stdlibIndexGzip: value.stdlibIndex?.asset
			}
		])
	);
	build.sysrootChunking = {
		format: 'dependency-closure-v1',
		commonImports: ['runtime', 'fmt', 'bufio', 'os'],
		maxOtherChunkBytes: MAX_OTHER_CHUNK_BYTES
	};
	await writeFile(buildPath, jsonBytes(build));
	return {
		changed: true,
		chunks: { wasi: baseChunks.length, js: jsChunks.length },
		deliveryBytes: outputs.reduce((sum, [, bytes]) => sum + bytes.length, 0)
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(
		JSON.stringify(await splitGoSysrootPacks(path.resolve(process.argv[2] ?? 'dist/runtime')))
	);
}
