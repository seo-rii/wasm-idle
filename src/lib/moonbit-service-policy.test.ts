// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyMoonbitServicePolicy } from '../../scripts/verify-moonbit-service-policy.mjs';
import { loadBundledProfile } from '../../scripts/verify-pinned-runtime-assets.mjs';

const execute = promisify(execFile);
const temporary: string[] = [];
async function fixture() {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'moonbit-service-policy-'));
	temporary.push(rootDir);
	await mkdir(path.join(rootDir, 'wasm-moonbit'));
	return rootDir;
}
afterEach(async () => {
	await Promise.all(
		temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('MoonBit publication containment', () => {
	it('permits the retained host/source records and unrelated language assets', async () => {
		const rootDir = await fixture();
		for (const name of [
			'upstream.json',
			'COMPILER-LICENSE.txt',
			'CORE-LICENSE.txt',
			'CORE-NOTICE.txt',
			'runner-worker.js'
		])
			await writeFile(path.join(rootDir, 'wasm-moonbit', name), 'retained record');
		await writeFile(
			path.join(rootDir, 'compressed-runtime-assets.v1.json'),
			JSON.stringify({ assets: ['wasm-rust/runtime.wasm'], sizes: {} })
		);
		await expect(verifyMoonbitServicePolicy({ rootDir })).resolves.toBeUndefined();
	});
	it.each(['moonc.js', 'moonc.js.gz', 'stdlib.tar', 'stdlib.tar.gz', 'code.wasm.gz.bin'])(
		'rejects a previously prepared payload without deleting it: %s',
		async (name) => {
			const rootDir = await fixture(),
				file = path.join(rootDir, 'wasm-moonbit', name);
			await writeFile(file, 'unreviewed payload');
			await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow(
				'publication is blocked'
			);
			expect(await readFile(file, 'utf8')).toBe('unreviewed payload');
		}
	);
	it('rejects compiler directories and symbolic links without traversing them', async () => {
		const rootDir = await fixture();
		await mkdir(path.join(rootDir, 'wasm-moonbit', 'moonc.assets'));
		await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow('moonc.assets');
		await rm(path.join(rootDir, 'wasm-moonbit'), { recursive: true });
		await symlink('/unrelated-do-not-read', path.join(rootDir, 'wasm-moonbit'));
		await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow('non-regular');
	});
	it.each([
		['compressed-runtime-assets.v1.json', { assets: ['wasm-moonbit/stdlib.tar'] }],
		[
			'layered-runtime-assets.v1.json',
			{
				layers: { shared: { path: 'shared/layer.gz' } },
				assets: { 'wasm-moonbit/moonc.js': { layer: 'shared' } }
			}
		],
		[
			'compact-runtime-aliases.v1.json',
			{ aliases: [{ from: 'wasm-moonbit/moonc.js.gz', to: 'shared/0123.gz.bin' }] }
		],
		['compressed-runtime-assets.v1.json.gz', { assets: ['wasm%2Dmoonbit%2Fstdlib.tar'] }]
	])(
		'rejects stale delivery references even when the original payload was removed: %s',
		async (name, index) => {
			const rootDir = await fixture(),
				bytes = Buffer.from(JSON.stringify(index));
			await writeFile(
				path.join(rootDir, name),
				name.endsWith('.gz') ? gzipSync(bytes) : bytes
			);
			await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow(
				'delivery reference'
			);
		}
	);
	it('refuses an uninspectable delivery index', async () => {
		const rootDir = await fixture();
		await symlink(
			'/unrelated-do-not-read',
			path.join(rootDir, 'layered-runtime-assets.v1.json')
		);
		await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow('uninspectable');
	});
	it('rejects a stale service Worker alias even without a delivery receipt', async () => {
		const rootDir = await fixture();
		await writeFile(
			path.join(rootDir, 'worker.js'),
			'const oldAlias = ["wasm-moonbit/moonc.js", "shared/opaque.bin"];'
		);
		await expect(verifyMoonbitServicePolicy({ rootDir })).rejects.toThrow(
			'generated service Worker'
		);
	});
	it('wires publication preflight before all normal build and publish entry points', async () => {
		const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
		expect(scripts['page:build']).not.toContain('sync:wasm-moonbit');
		for (const name of ['build', 'build:preview', 'page:build'])
			expect(scripts[name]).toMatch(/^pnpm run verify:moonbit-policy && /u);
		const publisher = await readFile('gh-pages.js', 'utf8');
		expect(publisher).toContain('await verifyMoonbitServicePolicy({ rootDir: buildDir })');
		expect(publisher.indexOf('await verifyMoonbitServicePolicy')).toBeLessThan(
			publisher.indexOf('if (!shouldSkipAssetVerification())')
		);
		const config = await readFile('vite.config.ts', 'utf8');
		expect(config).toContain("apply: 'build'");
		expect(config).toContain('await verifyMoonbitServicePolicy');
	});
	it('withholds compiler receipts from the default lock while keeping the pinned experimental profile', async () => {
		const { RUNTIME_ASSET_LOCK: lock } = await loadBundledProfile(
			new URL('../../packages/core/src/runtime-asset-lock.generated.ts', import.meta.url)
		);
		expect(Object.keys(lock.assets).filter((name) => name.startsWith('wasm-moonbit/'))).toEqual(
			[
				'wasm-moonbit/COMPILER-LICENSE.txt',
				'wasm-moonbit/CORE-LICENSE.txt',
				'wasm-moonbit/CORE-NOTICE.txt',
				'wasm-moonbit/runner-worker.js',
				'wasm-moonbit/upstream.json'
			]
		);
		const pin = JSON.parse(await readFile('static/wasm-moonbit/upstream.json', 'utf8'));
		expect(pin.revision).toBe('d4ada10d212b5376f7f8bf49cd2fbaa275a395df');
		expect(Object.keys(pin.assets)).toHaveLength(3);
	});
	it('blocks the direct producer before any asset creation, network fetch or compiler build', async () => {
		const rootDir = await fixture(),
			target = path.join(rootDir, 'not-created');
		await expect(
			execute('python3', ['runtimes/wasm-moonbit/prepare.py', '--output', target])
		).rejects.toMatchObject({
			code: 2,
			stderr: expect.stringContaining('service-license review')
		});
		await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
