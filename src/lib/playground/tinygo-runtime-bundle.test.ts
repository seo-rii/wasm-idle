import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeDir = path.join(checkoutRoot, 'static', 'wasm-tinygo');
const assetsDir = path.join(runtimeDir, 'assets');
const toolsDir = path.join(runtimeDir, 'tools');
const upstreamToolsDir = path.join(toolsDir, 'upstream');

describe('bundled wasm-tinygo runtime', () => {
	it('publishes only the receipt-verified upstream TinyGo compiler path', () => {
		expect(existsSync(path.join(runtimeDir, 'upstream.js'))).toBe(true);
		expect(existsSync(path.join(runtimeDir, 'runtime.js'))).toBe(false);
		expect(existsSync(path.join(toolsDir, 'tinygo-compiler.wasm'))).toBe(false);

		const assetEntries = readdirSync(assetsDir);
		expect(assetEntries.some((entry) => /^upstream-entry-.+\.js$/u.test(entry))).toBe(false);
		expect(assetEntries.some((entry) => /^upstream-compile-worker-.+\.js$/u.test(entry))).toBe(
			true
		);
		expect(assetEntries.some((entry) => /^runtime-.+\.js$/u.test(entry))).toBe(false);

		const upstreamEntry = readFileSync(path.join(runtimeDir, 'upstream.js'), 'utf8');
		expect(upstreamEntry).not.toMatch(/\.\/assets\/upstream-entry-.+\.js/u);
		expect(upstreamEntry).toMatch(/upstream-compile-worker-.+\.js/u);

		const manifest = JSON.parse(
			readFileSync(path.join(upstreamToolsDir, 'upstream-toolchain.v2.json'), 'utf8')
		) as {
			schemaVersion?: number;
			format?: string;
			assets?: { rootArchive?: { path?: string } };
		};
		expect(manifest).toMatchObject({
			schemaVersion: 2,
			format: 'wasm-idle-tinygo-upstream-assets-v2',
			assets: { rootArchive: { path: 'tinygoroot.tar.gz.bin' } }
		});
		expect(existsSync(path.join(upstreamToolsDir, 'tinygoroot.tar.gz.bin'))).toBe(true);
		expect(existsSync(path.join(upstreamToolsDir, 'tinygoroot.tar.gz'))).toBe(false);
	});
});
