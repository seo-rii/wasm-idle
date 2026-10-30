import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read format-level ABI data without relying on producer assertions. */
export function inspectWasm(bytes, { object = false } = {}) {
	assert.deepEqual(
		[...bytes.subarray(0, 8)],
		[0, 97, 115, 109, 1, 0, 0, 0],
		'Expected a WebAssembly v1 binary'
	);
	let offset = 8;
	let limit = bytes.length;
	function byte() {
		assert(offset < limit, 'Truncated WebAssembly section');
		return bytes[offset++];
	}
	function u32() {
		let value = 0;
		for (let shift = 0; shift < 35; shift += 7) {
			const part = byte();
			assert(shift < 28 || (part & 0xf0) === 0, 'Invalid WebAssembly u32');
			value += (part & 0x7f) * 2 ** shift;
			if (!(part & 0x80)) return value;
		}
		throw new Error('Invalid WebAssembly u32');
	}
	function name() {
		const length = u32();
		assert(offset + length <= limit, 'Truncated WebAssembly name');
		const value = new TextDecoder('utf-8', { fatal: true }).decode(
			bytes.subarray(offset, offset + length)
		);
		offset += length;
		return value;
	}
	function limits() {
		const flags = u32();
		assert((flags & ~3) === 0, 'Only wasm32 limits are supported');
		const initial = u32();
		const maximum = flags & 1 ? u32() : undefined;
		return {
			initial,
			...(maximum === undefined ? {} : { maximum }),
			shared: Boolean(flags & 2),
			memory64: false
		};
	}
	const result = {
		bytes: bytes.length,
		sha256: digest(bytes),
		imports: [],
		exports: [],
		memories: [],
		tables: [],
		customSections: [],
		sections: []
	};
	while (offset < bytes.length) {
		limit = bytes.length;
		const id = byte();
		const length = u32();
		limit = offset + length;
		assert(limit <= bytes.length, 'WebAssembly section extends beyond the artifact');
		result.sections.push({ id, bytes: length });
		if (id === 0) {
			result.customSections.push(name());
		} else if (id === 2) {
			for (let count = u32(); count > 0; count--) {
				const entry = { module: name(), name: name(), kind: byte() };
				if (entry.kind === 0) entry.typeIndex = u32();
				else if (entry.kind === 1) entry.table = { referenceType: byte(), ...limits() };
				else if (entry.kind === 2) entry.memory = limits();
				else if (entry.kind === 3) entry.global = { valueType: byte(), mutable: byte() };
				else if (entry.kind === 4) entry.tag = { attribute: byte(), typeIndex: u32() };
				else throw new Error(`Unknown WebAssembly import kind ${entry.kind}`);
				result.imports.push(entry);
			}
			assert.equal(offset, limit, 'Unexpected trailing import bytes');
		} else if (id === 4) {
			for (let count = u32(); count > 0; count--)
				result.tables.push({ referenceType: byte(), ...limits() });
			assert.equal(offset, limit, 'Unexpected trailing table bytes');
		} else if (id === 5) {
			for (let count = u32(); count > 0; count--) result.memories.push(limits());
			assert.equal(offset, limit, 'Unexpected trailing memory bytes');
		} else if (id === 7) {
			for (let count = u32(); count > 0; count--)
				result.exports.push({ name: name(), kind: byte(), index: u32() });
			assert.equal(offset, limit, 'Unexpected trailing export bytes');
		}
		offset = limit;
	}
	if (object) {
		assert(
			result.customSections.includes('linking'),
			'Wasm object is missing the linking custom section'
		);
		result.kind = 'wasm-relocatable-object';
	} else {
		assert(WebAssembly.validate(bytes), 'Linked program fails WebAssembly validation');
		assert(
			result.exports.some((entry) => entry.name === '_start' && entry.kind === 0),
			'WASI command must export _start'
		);
		assert(
			result.exports.some((entry) => entry.name === 'memory' && entry.kind === 2),
			'WASI command must export memory'
		);
		assert.equal(result.memories.length, 1, 'Expected one defined linear memory');
		assert(!result.memories[0].shared, 'Qualification covers single-threaded memory');
		assert(
			result.imports.every(
				(entry) => entry.module === 'wasi_snapshot_preview1' && entry.kind === 0
			),
			'Program imports something other than WASI Preview 1 functions'
		);
		result.kind = 'wasi-preview1-command';
	}
	return result;
}

export function runNodeWasi(file, fixture) {
	const options = fixture.runOptions || {};
	assert(!options.filesystemLimits, 'Node WASI cannot reproduce SDK memory filesystem quotas');
	assert(
		!(options.preopens || []).some((mount) => mount.readonly),
		'Node WASI cannot reproduce SDK read-only preopens'
	);
	const wireOptions = {
		...options,
		preopens: options.preopens?.map((mount) => ({
			...mount,
			files: mount.files?.map((file) => ({
				...file,
				contents: typeof file.contents === 'string' ? file.contents : [...file.contents]
			}))
		}))
	};
	const result = spawnSync(
		process.execPath,
		[
			'--no-warnings',
			fileURLToPath(new URL('./gcc-wasi-node-runner.mjs', import.meta.url)),
			file,
			'--qualification-options',
			JSON.stringify(wireOptions)
		],
		{
			input: fixture.stdin,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
			timeout: 30_000,
			maxBuffer: 1024 * 1024
		}
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, `${fixture.id}: Node WASI exit status; ${result.stderr}`);
	assert.equal(result.stdout, fixture.stdout, `${fixture.id}: Node WASI stdout`);
	assert.equal(result.stderr, '', `${fixture.id}: Node WASI stderr`);
	const { files } = JSON.parse(result.output[3]);
	if (fixture.expectedFiles)
		assertFileSnapshot(files, fixture.expectedFiles, `${fixture.id}: Node WASI files`);
	return {
		host: `node-${process.versions.node}`,
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
		files
	};
}

/** Compare complete, sorted snapshots, including binary and unchanged input files. */
export function assertFileSnapshot(actual, expected, message) {
	assert(Array.isArray(actual), `${message}: missing files array`);
	const normalize = (files) =>
		files.map(({ path: file, contents }) => ({
			path: file,
			contents:
				typeof contents === 'string'
					? [...new TextEncoder().encode(contents)]
					: [...contents]
		}));
	assert.deepEqual(normalize(actual), normalize(expected), message);
}

export async function readBundleFile(directory, receipt) {
	assert(
		receipt && typeof receipt.path === 'string' && /^[A-Za-z0-9._/-]+$/.test(receipt.path),
		'Invalid asset receipt path'
	);
	assert(
		!path.isAbsolute(receipt.path) &&
			!receipt.path.split('/').some((part) => !part || part === '.' || part === '..'),
		'Invalid asset receipt path'
	);
	const file = await fs.realpath(path.join(directory, receipt.path));
	assert(file.startsWith(directory + path.sep), 'Asset escapes bundle directory');
	const bytes = await fs.readFile(file);
	if (receipt.bytes !== undefined)
		assert.equal(bytes.length, receipt.bytes, `${receipt.path}: byte count mismatch`);
	assert.equal(digest(bytes), receipt.sha256, `${receipt.path}: SHA-256 mismatch`);
	return bytes;
}

/** Size the complete eager manifest payload and its reproducible gzip encoding. */
export async function measureBundle(directory, manifestBytes, manifest) {
	const assets = [];
	for (const [name, receipt] of Object.entries(manifest.assets)) {
		const bytes = await readBundleFile(directory, receipt);
		assets.push({
			name,
			path: receipt.path,
			bytes: bytes.length,
			gzipBytes: gzipSync(bytes, { level: 9 }).length,
			sha256: receipt.sha256
		});
	}
	const manifestSize = {
		bytes: manifestBytes.length,
		gzipBytes: gzipSync(manifestBytes, { level: 9 }).length,
		sha256: digest(manifestBytes)
	};
	return {
		encoding: 'gzip-level-9',
		note: 'Reproducible compressed payload estimate; excludes HTTP headers and browser SDK modules, which are measured separately.',
		manifest: manifestSize,
		assets,
		uncompressedBytes: assets.reduce((total, asset) => total + asset.bytes, manifestSize.bytes),
		gzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, manifestSize.gzipBytes)
	};
}
