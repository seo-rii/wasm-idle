import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_ASSET_VERSION
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

interface RubyRuntimeManifest {
	formatVersion: number;
	runtimeModule: string;
	packages: Record<string, string>;
	files: Array<{ path: string; bytes: number; sha256: string }>;
}

const runtimeRoot = resolve(process.cwd(), 'static/wasm-ruby');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const lexicalCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const fingerprintManifest = (manifest: RubyRuntimeManifest) => {
	const hash = createHash('sha256');
	hash.update('wasm-idle:ruby-runtime:v1\n');
	hash.update(`formatVersion\0${manifest.formatVersion}\n`);
	for (const [name, version] of Object.entries(manifest.packages).sort(([left], [right]) =>
		lexicalCompare(left, right)
	)) {
		hash.update(`${name}\0${version}\n`);
	}
	for (const file of [...manifest.files].sort((left, right) =>
		lexicalCompare(left.path, right.path)
	)) {
		hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
	}
	return hash.digest('hex');
};

describe('checked-in Ruby runtime trust root', () => {
	it('binds the exact static module and logical Wasm bytes to the Core profile', async () => {
		const rootEntries = await readdir(runtimeRoot, { withFileTypes: true });
		const assetEntries = await readdir(resolve(runtimeRoot, 'assets'), {
			withFileTypes: true
		});
		const files = [
			...rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
			...assetEntries.filter((entry) => entry.isFile()).map((entry) => `assets/${entry.name}`)
		].sort(lexicalCompare);
		expect(files).toEqual([
			`${RUBY_RUNTIME_ASSET_PATH}.gz`,
			'runtime-manifest.v1.json',
			'runtime.mjs'
		]);

		const manifest = JSON.parse(
			await readFile(resolve(runtimeRoot, 'runtime-manifest.v1.json'), 'utf8')
		) as RubyRuntimeManifest;
		expect(Object.keys(manifest).sort(lexicalCompare)).toEqual([
			'files',
			'formatVersion',
			'packages',
			'runtimeModule'
		]);
		expect(manifest).toMatchObject({
			formatVersion: 1,
			runtimeModule: 'runtime.mjs',
			packages: {
				'@ruby/3.4-wasm-wasi': '2.9.3-2.9.4',
				'@ruby/wasm-wasi': '2.9.3-2.9.4'
			}
		});
		expect(Object.keys(manifest.packages).sort(lexicalCompare)).toEqual([
			'@ruby/3.4-wasm-wasi',
			'@ruby/wasm-wasi'
		]);

		const moduleBytes = await readFile(resolve(runtimeRoot, 'runtime.mjs'));
		const storedWasm = await readFile(resolve(runtimeRoot, `${RUBY_RUNTIME_ASSET_PATH}.gz`));
		const logicalWasm = gunzipSync(storedWasm);
		const actualReceipts = {
			'runtime.mjs': { bytes: moduleBytes.byteLength, sha256: sha256(moduleBytes) },
			[RUBY_RUNTIME_ASSET_PATH]: {
				bytes: logicalWasm.byteLength,
				sha256: sha256(logicalWasm)
			}
		};
		expect(manifest.files).toEqual(
			Object.entries(actualReceipts)
				.map(([path, receipt]) => ({ path, ...receipt }))
				.sort((left, right) => lexicalCompare(left.path, right.path))
		);
		expect(actualReceipts).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(fingerprintManifest(manifest)).toBe(RUBY_RUNTIME_ASSET_VERSION);
		expect({ bytes: storedWasm.byteLength, sha256: sha256(storedWasm) }).toEqual({
			bytes: 9_051_961,
			sha256: '4bffd8398d79eed9e5bbe7cd809a88bd3cb861642054a6f3d63b2abfa80f3030'
		});

		const source = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
		const expression = `new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)},import.meta.url)`;
		expect(source.split(expression)).toHaveLength(2);
	});
});
