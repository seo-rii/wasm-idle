import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/browser-execution.js', () => ({
	executeBrowserRustArtifact: vi.fn()
}));

import createRustCompiler, {
	createRustCompiler as createNamedCompiler,
	preloadBrowserRustRuntime
} from '../src/index.js';
import {
	FakeWorker,
	createRuntimeManifest,
	createRuntimeManifestV3,
	mirrorBitcode
} from './helpers.js';

describe('wasm-rust compiler contract', () => {
	it('exports both default and named factory functions', async () => {
		const defaultCompiler = await createRustCompiler();
		const namedCompiler = await createNamedCompiler();

		expect(typeof defaultCompiler.compile).toBe('function');
		expect(typeof namedCompiler.compile).toBe('function');
	});

	it('links mirrored LLVM bitcode into a wasm artifact through injected dependencies', async () => {
		let clock = 0;
		const bitcode = new Uint8Array([1, 2, 3, 4]);
		const compiler = await createRustCompiler({
			dependencies: {
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () =>
					new FakeWorker((message) => {
						mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
					}),
				linkBitcode: async (receivedBitcode) => {
					expect(receivedBitcode).toEqual(bitcode);
					return {
						wasm: new Uint8Array([9, 8, 7]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					};
				},
				now: () => clock,
				sleep: async (milliseconds) => {
					clock += milliseconds;
				}
			}
		});
		const result = await compiler.compile({
			code: 'fn main() { println!("hi"); }',
			edition: '2024',
			crateType: 'bin'
		});

		expect(result.success).toBe(true);
		expect(result.artifact?.wasm).toEqual(new Uint8Array([9, 8, 7]));
		expect(result.artifact?.targetTriple).toBe('wasm32-wasip1');
		expect(result.artifact?.format).toBe('core-wasm');
		expect(result.artifact?.wat).toBeUndefined();
	});

	it('preloads selected target runtime assets and component modules', async () => {
		const fetchedUrls: string[] = [];
		const importedUrls: string[] = [];

		await preloadBrowserRustRuntime({
			targetTriple: 'wasm32-wasip3',
			dependencies: {
				loadManifest: async () => createRuntimeManifestV3(),
				fetchImpl: async (assetUrl) => {
					fetchedUrls.push(assetUrl.toString());
					return new Response(new Uint8Array([1, 2, 3]));
				},
				importRuntimeModule: async (assetUrl) => {
					importedUrls.push(assetUrl);
					return {};
				}
			}
		});

		expect(fetchedUrls).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/compiler-worker\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/rustc-thread-worker\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/runtime\/rustc\/rustc\.wasm\.gz\?v=test-runtime-v3$/),
				expect.stringMatching(
					/runtime\/packs\/sysroot\/wasm32-wasip3\.index\.json\.gz\?v=test-runtime-v3$/
				),
				expect.stringMatching(
					/runtime\/packs\/sysroot\/wasm32-wasip3\.pack\.gz\?v=test-runtime-v3$/
				),
				expect.stringMatching(/runtime\/llvm\/llc\.wasm\.gz\?v=test-runtime-v3$/),
				expect.stringMatching(/runtime\/llvm\/lld\.wasm\.gz\?v=test-runtime-v3$/),
				expect.stringMatching(/runtime\/llvm\/lld\.data\.gz\?v=test-runtime-v3$/),
				expect.stringMatching(
					/runtime\/packs\/link\/wasm32-wasip3\.index\.json\.gz\?v=test-runtime-v3$/
				),
				expect.stringMatching(
					/runtime\/packs\/link\/wasm32-wasip3\.pack\.gz\?v=test-runtime-v3$/
				),
				expect.stringMatching(
					/vendor\/jco\/lib\/wasi_snapshot_preview1\.command\.wasm\?v=test-runtime-v3$/
				)
			])
		);
		expect(importedUrls).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/runtime\/llvm\/llc\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/runtime\/llvm\/lld\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/vendor\/jco\/src\/browser\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/vendor\/jco\/obj\/wasm-tools\.js\?v=test-runtime-v3$/),
				expect.stringMatching(/vendor\/preview2-shim\/lib\/browser\/cli\.js\?v=test-runtime-v3$/),
				expect.stringMatching(
					/vendor\/preview2-shim\/lib\/browser\/filesystem\.js\?v=test-runtime-v3$/
				),
				expect.stringMatching(/vendor\/preview2-shim\/lib\/browser\/io\.js\?v=test-runtime-v3$/),
				expect.stringMatching(
					/vendor\/preview2-shim\/lib\/browser\/random\.js\?v=test-runtime-v3$/
				),
				expect.stringMatching(
					/vendor\/preview2-shim\/lib\/browser\/clocks\.js\?v=test-runtime-v3$/
				),
				expect.stringMatching(
					/vendor\/preview2-shim\/lib\/browser\/sockets\.js\?v=test-runtime-v3$/
				),
				expect.stringMatching(/vendor\/preview2-shim\/lib\/browser\/http\.js\?v=test-runtime-v3$/)
			])
		);
	});
});
