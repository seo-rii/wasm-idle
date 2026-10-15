// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import {
	releaseBaseUrl,
	syncWasmLean4Assets,
	verifyLean4Release
} from '../../scripts/sync-wasm-lean4.mjs';
import { WASM_LEAN4_PROFILE } from './playground/wasmLean4Version';

const lockUrl = new URL('../../scripts/wasm-lean4-assets.lock.json', import.meta.url);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encoded = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);

function fixture() {
	const raw = Buffer.from('abcde');
	const wasm = Buffer.from('0061736d01000000', 'hex');
	const files = new Map<string, Uint8Array>([
		['lean.mjs', Buffer.from('export default function createLean() {}')],
		['lean.wasm.gz.bin', gzipSync(wasm)],
		['lean-init-00.pack.gz.bin', gzipSync(raw)],
		['LICENSE', Buffer.from('Apache-2.0')],
		['LICENSE.libuv', Buffer.from('MIT')]
	]);
	const asset = (name: string, decoded?: Buffer) => {
		const bytes = files.get(name)!;
		return {
			upstream: name.replace(/\.gz\.bin$/, '.gz'),
			bytes: bytes.length,
			sha256: digest(bytes),
			...(decoded
				? {
						encoding: 'gzip',
						logicalName: name.replace(/\.gz\.bin$/, ''),
						uncompressed: { bytes: decoded.length, sha256: digest(decoded) }
					}
				: {})
		};
	};
	const chunk = asset('lean-init-00.pack.gz.bin', raw);
	const index = {
		schemaVersion: 1,
		root: '/lean/lib/lean',
		modules: 1,
		totalBytes: raw.length,
		sha256: digest(raw),
		chunks: [
			{
				path: chunk.upstream,
				offset: 0,
				bytes: chunk.bytes,
				sha256: chunk.sha256,
				uncompressedBytes: raw.length,
				uncompressedSha256: digest(raw)
			}
		],
		files: ['.ir', '.ir.sig', '.olean', '.olean.private', '.olean.server'].map(
			(extension, offset) => ({ path: `Init${extension}`, offset, bytes: 1 })
		)
	};
	files.set('lean-init.index.json', encoded(index));
	const lock: any = {
		schemaVersion: 1,
		source: 'a'.repeat(40),
		version: '4.34.1',
		assets: {
			'lean.mjs': asset('lean.mjs'),
			'lean.wasm.gz.bin': asset('lean.wasm.gz.bin', wasm),
			'lean-init-00.pack.gz.bin': chunk,
			'lean-init.index.json': asset('lean-init.index.json')
		},
		notices: { LICENSE: asset('LICENSE'), 'LICENSE.libuv': asset('LICENSE.libuv') }
	};
	const original: any = {
		schemaVersion: 1,
		producerId: 'wasm-llvm/lean-browser',
		sources: { lean4: { commit: lock.source, version: lock.version } },
		assets: Object.fromEntries(
			Object.values({ ...lock.assets, ...lock.notices }).map((entry: any) => [
				entry.upstream,
				{
					bytes: entry.bytes,
					sha256: entry.sha256,
					...(entry.upstream === 'lean.wasm.gz'
						? { uncompressed: entry.uncompressed }
						: {})
				}
			])
		),
		library: 1,
		recipe: { 'scripts/build.sh': 'a'.repeat(64), 'scripts/package.mjs': 'b'.repeat(64) },
		acceptance: {
			node: {
				program: { exitCode: 0, stdout: 'Hello, 안녕!\nsum = 40\n' },
				diagnostic: { exitCode: 1 }
			}
		}
	};
	const receipt: any = {
		...structuredClone(original),
		requalification: {
			kind: 'same-byte-repackage',
			compilerRebuilt: false,
			originalReceiptSha256: digest(encoded(original)),
			originalReceipt: original
		}
	};
	const refresh = () => {
		files.set('lean-init.index.json', encoded(index));
		files.set('producer-receipt.json', encoded(receipt));
		lock.assets['producer-receipt.json'] = asset('producer-receipt.json');
	};
	refresh();
	return { lock, files, receipt, index, refresh };
}

it('accepts a complete same-byte requalification without claiming a compiler rebuild', () => {
	const { lock, files } = fixture();
	expect(() => verifyLean4Release(lock, files)).not.toThrow();
});

it('requires the runtime loader independently of the receipt and lock asset lists', () => {
	const { lock, files, receipt, refresh } = fixture();
	delete lock.assets['lean.mjs'];
	delete receipt.assets['lean.mjs'];
	delete receipt.requalification.originalReceipt.assets['lean.mjs'];
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('missing required asset lean.mjs');
});

it.each(['0', false])('rejects a non-integer successful acceptance exit code %s', (code) => {
	const { lock, files, receipt, refresh } = fixture();
	receipt.acceptance.node.program.exitCode = code;
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('does not match the reviewed release');
});

it('rejects relabeling same-byte packaging as a compiler rebuild', () => {
	const { lock, files, receipt, refresh } = fixture();
	receipt.requalification.compilerRebuilt = true;
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('requalification provenance');
});

it('rejects a changed original receipt or build recipe', () => {
	const { lock, files, receipt, refresh } = fixture();
	receipt.requalification.originalReceipt.library = 2;
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('requalification provenance');
	receipt.requalification.originalReceipt.library = 1;
	receipt.recipe['scripts/build.sh'] = 'c'.repeat(64);
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('changed build recipe');
});

it.each(['path', 'offset', 'bytes'])('rejects malformed library file %s', (field) => {
	const { lock, files, index, refresh } = fixture();
	(index.files[1] as any)[field] =
		field === 'path' ? index.files[0].path : field === 'offset' ? -1 : 1.5;
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('Invalid Lean 4 library entry');
});

it('rejects a library chunk outside the locked asset set', () => {
	const { lock, files, index, refresh } = fixture();
	index.chunks[0].path = '../unreviewed.pack.gz';
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow('Invalid Lean 4 library chunk');
});

it('bounds gzip output before decoding more bytes than declared', () => {
	const { lock, files, receipt, refresh } = fixture();
	lock.assets['lean.wasm.gz.bin'].uncompressed.bytes = 7;
	receipt.assets['lean.wasm.gz'].uncompressed.bytes = 7;
	receipt.requalification.originalReceipt.assets['lean.wasm.gz'].uncompressed.bytes = 7;
	receipt.requalification.originalReceiptSha256 = digest(
		encoded(receipt.requalification.originalReceipt)
	);
	refresh();
	expect(() => verifyLean4Release(lock, files)).toThrow(/larger than 7 bytes/);
});

it('pins every Lean 4 asset to an immutable wasm-llvm commit URL', async () => {
	const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
	expect(releaseBaseUrl(lock)).toBe(
		`https://raw.githubusercontent.com/seo-rii/wasm-llvm/${lock.producer.revision}/artifacts/lean-browser/`
	);
	expect(lock.producer.revision).toMatch(/^[0-9a-f]{40}$/);
	expect(lock.version).toBe('4.34.1');
	for (const [name, asset] of Object.entries(lock.assets) as [string, any][]) {
		expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
		// Compressed storage uses the canonical inert .gz.bin suffix and records decoded receipts.
		if (asset.encoding === 'gzip') {
			expect(name).toBe(`${asset.upstream}.bin`);
			expect(asset.uncompressed.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(asset.logicalName).toBe(asset.upstream.replace(/\.gz$/, ''));
		} else expect(name).toBe(asset.upstream);
		expect(asset.bytes).toBeLessThan(24_000_000);
	}
	expect(Object.keys(lock.assets).filter((name) => name.startsWith('lean-init-'))).toHaveLength(
		6
	);
	const { notices: _notices, ...runtimeLock } = lock;
	const { workerReceipt: _workerReceipt, ...profile } = WASM_LEAN4_PROFILE;
	expect(profile).toEqual(runtimeLock);
});

it('rejects a release with altered bytes before touching the target or profile', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lean4-sync-'));
	try {
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		const target = path.join(directory, 'target');
		const version = path.join(directory, 'profile.ts');
		await writeFile(target, 'existing runtime');
		await writeFile(version, 'existing profile');
		await writeFile(
			path.join(directory, 'producer-receipt.json'),
			Buffer.alloc(lock.assets['producer-receipt.json'].bytes)
		);
		await expect(
			syncWasmLean4Assets({
				sourceDir: directory,
				targetDir: target,
				versionModulePath: version
			})
		).rejects.toThrow('does not match the reviewed lock');
		expect(await readFile(target, 'utf8')).toBe('existing runtime');
		expect(await readFile(version, 'utf8')).toBe('existing profile');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it('rejects downloads whose size differs from the lock', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lean4-download-'));
	try {
		const requested: string[] = [];
		const fetchImpl = (async (url: string) => {
			requested.push(String(url));
			return new Response(new Uint8Array(3));
		}) as unknown as typeof fetch;
		await expect(
			syncWasmLean4Assets({
				targetDir: path.join(directory, 'target'),
				versionModulePath: path.join(directory, 'profile.ts'),
				fetchImpl
			})
		).rejects.toThrow(/returned 3 bytes/);
		expect(requested[0]).toMatch(
			/^https:\/\/raw\.githubusercontent\.com\/seo-rii\/wasm-llvm\/[0-9a-f]{40}\/artifacts\/lean-browser\//
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
