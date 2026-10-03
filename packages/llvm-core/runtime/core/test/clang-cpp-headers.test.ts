import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { CLANG_CPP_HEADER_ANCHOR, CLANG_CPP_HEADERS } from '../src/clang-cpp-headers.generated.js';
import { installClangCppHeaders } from '../src/clang-cpp-headers.js';
import { CLANG_RESOURCE_HEADER_PROVENANCE as provenance } from '../src/clang-resource-headers.js';
import untar from '../src/tar.js';

const root = new URL('../../../../../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('scripts/clang-cpp-headers.lock.json', root), 'utf8'));
const anchor = readFileSync(new URL('fixtures/clang-cpp-headers/ostream', import.meta.url));
const prefix = '/include/c++/v1/';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const makeFs = (files = new Map<string, Uint8Array>([[`${prefix}ostream`, anchor]])) => ({
	files,
	readFile: (path: string) => files.get(path) ?? null,
	mkdirTree: vi.fn(),
	writeFile: vi.fn((path: string, contents: Uint8Array) => files.set(path, contents))
});

describe('pinned C++23 and C++26 sysroot repair', () => {
	it('keeps the actual libc++ headers and anchor byte-exact to the pinned LLVM sources', () => {
		expect(lock.version).toBe(provenance.version);
		expect(lock.revision).toBe(provenance.revision);
		expect(Object.keys(CLANG_CPP_HEADERS)).toEqual(
			lock.headers.map((entry: { path: string }) => entry.path)
		);
		for (const entry of lock.headers) {
			const bytes = Buffer.from(CLANG_CPP_HEADERS[entry.path]);
			expect(bytes.byteLength, entry.path).toBe(entry.bytes);
			expect(sha256(bytes), entry.path).toBe(entry.sha256);
		}
		expect(CLANG_CPP_HEADER_ANCHOR).toEqual({
			path: lock.anchor.path,
			bytes: lock.anchor.bytes,
			sha256: lock.anchor.sha256
		});
		expect(anchor.byteLength).toBe(lock.anchor.bytes);
		expect(sha256(anchor)).toBe(lock.anchor.sha256);
		expect(sha256(readFileSync(new URL('packages/llvm-core/LICENSE.llvm.txt', root)))).toBe(
			lock.license.sha256
		);
	});

	it('restores missing conditional dependencies and is idempotent with an already repaired sysroot', async () => {
		const fs = makeFs();
		await expect(installClangCppHeaders(fs, provenance)).resolves.toBe(true);
		for (const name of [
			'__ostream/print.h',
			'__algorithm/ranges_fold.h',
			'__type_traits/is_within_lifetime.h'
		]) {
			expect(fs.readFile(prefix + name)).toEqual(
				new TextEncoder().encode(CLANG_CPP_HEADERS[name])
			);
		}
		expect(fs.writeFile).toHaveBeenCalledTimes(lock.headers.length);
		fs.writeFile.mockClear();
		await expect(installClangCppHeaders(fs, provenance)).resolves.toBe(true);
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it('rejects a conflicting existing header before writing any missing header', async () => {
		const fs = makeFs();
		fs.files.set(`${prefix}__vector/vector_bool_formatter.h`, Buffer.from('custom header'));
		await expect(installClangCppHeaders(fs, provenance)).rejects.toThrow('C++ header differs');
		expect(fs.writeFile).not.toHaveBeenCalled();
		expect(fs.mkdirTree).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		{ ...provenance, version: '21.1.0' },
		{ ...provenance, revision: 'custom' }
	])('leaves another compiler provenance untouched: %j', async (other) => {
		const fs = makeFs();
		await expect(installClangCppHeaders(fs, other)).resolves.toBe(false);
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it('leaves both C-only sysroots and custom libc++ headers untouched', async () => {
		const cOnly = makeFs(new Map());
		await expect(installClangCppHeaders(cOnly, provenance)).resolves.toBe(false);
		expect(cOnly.writeFile).not.toHaveBeenCalled();
		const custom = makeFs();
		const changed = Buffer.from(anchor);
		changed[changed.length - 1] ^= 1;
		custom.files.set(`${prefix}ostream`, changed);
		await expect(installClangCppHeaders(custom, provenance)).resolves.toBe(false);
		expect(custom.writeFile).not.toHaveBeenCalled();
	});

	const loadArchive = async (fs: ReturnType<typeof makeFs>, name: string) => {
		await untar(gunzipSync(readFileSync(new URL(`static/clang/bin/${name}`, root))), {
			addDirectory: () => {},
			addFile: (path, contents) => fs.files.set(`/${path.replace(/^\/+/, '')}`, contents)
		});
	};
	const archives = ['sysroot.tar.gz', 'c-sysroot.tar.gz', 'cpp-addon.tar.gz'];
	it.skipIf(archives.some((name) => !existsSync(new URL(`static/clang/bin/${name}`, root))))(
		'repairs the shipped monolithic and split sysroots to the same header contents',
		async () => {
			const monolithic = makeFs(new Map());
			await loadArchive(monolithic, 'sysroot.tar.gz');
			await expect(installClangCppHeaders(monolithic, provenance)).resolves.toBe(true);
			const split = makeFs(new Map());
			await loadArchive(split, 'c-sysroot.tar.gz');
			await expect(installClangCppHeaders(split, provenance)).resolves.toBe(false);
			await loadArchive(split, 'cpp-addon.tar.gz');
			await expect(installClangCppHeaders(split, provenance)).resolves.toBe(true);
			for (const name of Object.keys(CLANG_CPP_HEADERS)) {
				expect(split.readFile(prefix + name)).toEqual(monolithic.readFile(prefix + name));
			}
		}
	);
});
