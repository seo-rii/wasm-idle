import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { CLANG_RESOURCE_HEADERS } from '../src/clang-resource-headers.generated.js';
import {
	CLANG_RESOURCE_HEADER_DIRECTORY as resourceDir,
	CLANG_RESOURCE_HEADER_PROVENANCE as provenance,
	installClangResourceHeaders
} from '../src/clang-resource-headers.js';
import untar from '../src/tar.js';

const root = new URL('../../../../../', import.meta.url);
const lock = JSON.parse(
	readFileSync(new URL('scripts/clang-resource-headers.lock.json', root), 'utf8')
);
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const makeFs = (files = new Map<string, Uint8Array>()) => ({
	files,
	readFile: (path: string) => files.get(path) ?? null,
	mkdirTree: vi.fn(),
	writeFile: vi.fn((path: string, contents: Uint8Array) => files.set(path, contents))
});

describe('pinned Clang resource headers', () => {
	it('keeps every header and its license byte-exact to LLVM 22.1.8 source receipts', () => {
		expect(provenance.version).toBe(lock.version);
		expect(provenance.revision).toBe(lock.revision);
		expect(Object.keys(CLANG_RESOURCE_HEADERS)).toEqual(
			lock.headers.map((header: { path: string }) => header.path)
		);
		for (const receipt of lock.headers) {
			const bytes = Buffer.from(CLANG_RESOURCE_HEADERS[receipt.path]);
			expect(bytes.length, receipt.path).toBe(receipt.bytes);
			expect(sha256(bytes), receipt.path).toBe(receipt.sha256);
		}
		expect(sha256(readFileSync(new URL('packages/llvm-core/LICENSE.llvm.txt', root)))).toBe(
			lock.license.sha256
		);
	});

	it('installs real boolean and standard argument/declaration dependencies for both hosts', () => {
		const executionFs = makeFs();
		const lspFs = makeFs();
		for (const fs of [executionFs, lspFs]) {
			expect(installClangResourceHeaders(fs, provenance, resourceDir)).toBe(true);
			for (const name of [
				'stdbool.h',
				'stdarg.h',
				'stddef.h',
				'__stdarg_va_list.h',
				'__stddef_size_t.h'
			]) {
				expect(fs.readFile(`${resourceDir}/include/${name}`)).toEqual(
					new TextEncoder().encode(CLANG_RESOURCE_HEADERS[name])
				);
			}
			expect(fs.readFile(`${resourceDir}/include/not-a-real-header.h`)).toBeNull();
		}
		expect(executionFs.files).toEqual(lspFs.files);
	});

	it('retains existing matching headers and rejects conflicting content before writing', () => {
		const fs = makeFs(
			new Map([
				[
					`${resourceDir}/include/stdbool.h`,
					Buffer.from(CLANG_RESOURCE_HEADERS['stdbool.h'])
				]
			])
		);
		installClangResourceHeaders(fs, provenance, resourceDir);
		expect(fs.writeFile.mock.calls.some(([path]) => path.endsWith('/stdbool.h'))).toBe(false);
		fs.files.set(`${resourceDir}/include/stdbool.h`, Buffer.from('#define bool int'));
		fs.writeFile.mockClear();
		expect(() => installClangResourceHeaders(fs, provenance, resourceDir)).toThrow(
			'resource header differs'
		);
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		{ ...provenance, version: '8.0.1' },
		{ ...provenance, revision: 'different-build' }
	])('does not inject these headers into another compiler provenance: %j', (other) => {
		const fs = makeFs();
		expect(installClangResourceHeaders(fs, other, resourceDir)).toBe(false);
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	const archiveUrl = new URL('static/clang/bin/sysroot.tar.gz', root);
	it.skipIf(!existsSync(archiveUrl))(
		'repairs the shipped sysroot without replacing its 17 matching resource headers',
		async () => {
			const manifest = JSON.parse(
				readFileSync(new URL('static/clang/runtime-manifest.v1.json', root), 'utf8')
			);
			const build = JSON.parse(
				readFileSync(new URL('static/clang/runtime-build.json', root), 'utf8')
			);
			expect(manifest.compiler.provenance).toEqual(provenance);
			expect(build.toolchain.llvmCommit).toBe(provenance.revision);
			const archive = readFileSync(archiveUrl);
			expect(sha256(archive)).toBe(
				build.assets.find((asset: { asset: string }) => asset.asset === 'sysroot.tar.gz')
					.sha256
			);
			const fs = makeFs();
			await untar(gunzipSync(archive), {
				addDirectory: () => {},
				addFile: (path, contents) => fs.files.set(`/${path.replace(/^\/+/, '')}`, contents)
			});
			const before = new Set(
				[...fs.files.keys()].filter((path) => path.startsWith(`${resourceDir}/include/`))
			);
			expect(before.size).toBe(17);
			installClangResourceHeaders(
				fs,
				manifest.compiler.provenance,
				manifest.compiler.resourceDir
			);
			expect(fs.writeFile).toHaveBeenCalledTimes(21);
			for (const [path] of fs.writeFile.mock.calls) expect(before.has(path)).toBe(false);
			expect(fs.readFile(`${resourceDir}/include/stdbool.h`)).toEqual(
				new TextEncoder().encode(CLANG_RESOURCE_HEADERS['stdbool.h'])
			);
		}
	);
});
