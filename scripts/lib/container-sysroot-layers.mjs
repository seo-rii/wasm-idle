import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { extractTarPackage } from '@wasm-idle/container';
import { composeSysrootLayers } from '../../examples/container/sysroot-layers.mjs';

const identity = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const cxxArchives = new Set(['lib/wasm32-wasi/libc++.a', 'lib/wasm32-wasi/libc++abi.a']);
const isCxx = (path) =>
	path === 'include/c++' || path.startsWith('include/c++/') || cxxArchives.has(path);

/** Derive delivery layers from an independently pinned, complete selected-target sysroot. */
export function prepareContainerSysrootLayers(input, originalDistribution, expected) {
	assert(
		input instanceof Uint8Array && input.length <= 128 * 1024 * 1024,
		'Bounded sysroot bytes required'
	);
	assert.deepEqual(
		identity(input),
		{ bytes: expected.bytes, sha256: expected.sha256 },
		'Pinned full sysroot required before deriving layers'
	);
	const entries = extractTarPackage(input);
	assert(
		entries.some(
			(entry) => entry.path === 'lib/clang/22/include' && entry.type === 'directory'
		),
		'c-base-v1 requires the Clang 22 resource header layout'
	);
	const records = { c: [], cxx: [] };
	const counts = { c: 0, cxx: 0 };
	const text = (header, offset, length) =>
		header
			.subarray(offset, offset + length)
			.toString('utf8')
			.replace(/\0.*$/su, '');
	const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	for (let offset = 0; offset + 512 <= bytes.length;) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const prefix = text(header, 345, 155),
			name = text(header, 0, 100);
		const path = (prefix ? `${prefix}/${name}` : name).replace(/\/$/u, '');
		const size = Number.parseInt(text(header, 124, 12).trim(), 8);
		const end = offset + 512 + Math.ceil(size / 512) * 512;
		const group = isCxx(path) ? 'cxx' : 'c';
		records[group].push(bytes.subarray(offset, end));
		counts[group]++;
		offset = end;
	}
	const base = Buffer.concat([...records.c, Buffer.alloc(1024)]);
	const cxx = Buffer.concat([...records.cxx, Buffer.alloc(1024)]);
	const full = composeSysrootLayers(base, cxx);
	extractTarPackage(full);
	const compressed = { c: gzipSync(base, { level: 9 }), cxx: gzipSync(cxx, { level: 9 }) };
	const receipt = {
		schemaVersion: 1,
		kind: 'container-c-cxx-sysroot-layers',
		compression: { format: 'gzip', level: 9, zlib: process.versions.zlib },
		resourceDirectory: 'lib/clang/22',
		source: identity(bytes),
		full: identity(full),
		c: { logical: identity(base), delivery: identity(compressed.c), records: counts.c },
		cxx: { logical: identity(cxx), delivery: identity(compressed.cxx), records: counts.cxx }
	};
	const distribution = structuredClone(originalDistribution);
	const llvm = distribution.packages.find((pkg) => pkg.id === 'llvm');
	assert(
		llvm?.assets.some((asset) => asset.id === 'sysroot'),
		'Expected the complete legacy LLVM sysroot asset'
	);
	llvm.assets = llvm.assets.filter((asset) => asset.id !== 'sysroot');
	llvm.files = llvm.files.filter((file) => file.asset !== 'sysroot');
	llvm.identity = `sha256:${identity(Buffer.from(JSON.stringify({ assets: llvm.assets, files: llvm.files }))).sha256}`;
	for (const group of ['c', 'cxx']) {
		const id = `llvm-sysroot-${group}`;
		distribution.packages.push({
			id,
			identity: `sha256:${receipt[group].logical.sha256}`,
			producer: { ...llvm.producer },
			dependencies: [],
			mount: `/opt/toolchains/${id}`,
			capabilities: [],
			assets: [
				{
					id: `sysroot-${group}`,
					url: 'https://invalid.example/sysroot',
					encoding: 'gzip',
					delivery: { ...receipt[group].delivery, mediaType: 'application/octet-stream' },
					logical: { ...receipt[group].logical, mediaType: 'application/octet-stream' }
				}
			],
			files: [{ path: 'sysroot.tar', asset: `sysroot-${group}`, executable: false }]
		});
	}
	return {
		distribution,
		receipt,
		config: {
			schemaVersion: 1,
			basePackage: 'llvm-sysroot-c',
			cxxPackage: 'llvm-sysroot-cxx',
			full: receipt.full
		},
		deliveries: new Map([
			['sysroot-c', compressed.c],
			['sysroot-cxx', compressed.cxx]
		])
	};
}
