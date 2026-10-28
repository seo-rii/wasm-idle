// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileZigDebugArtifact, snapshotZigDebugBackend } from './zigDebug';

const backendRuntime = vi.hoisted(() => ({ compileBitcodeArtifact: vi.fn() }));
vi.mock('@wasm-idle/llvm-core/clang', () => ({
	BrowserClangRuntime: class {
		compileBitcodeArtifact = backendRuntime.compileBitcodeArtifact;
	},
	resolveRuntimeManifestUrl: (base: string) => new URL('runtime-manifest.v1.json', base).href,
	loadRuntimeManifest: async () => ({
		compiler: {
			provenance: { name: 'clang', version: '22.1.8' },
			sysroot: { asset: 'bin/sysroot.tar.gz' }
		}
	})
}));

const receipt = {
	bytes: 1,
	sha256: 'a'.repeat(64),
	uncompressedBytes: 1,
	uncompressedSha256: 'a'.repeat(64)
};
const dwarfModule = () =>
	new Uint8Array([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...['.debug_info', '.debug_line'].flatMap((section) => [
			0,
			section.length + 2,
			section.length,
			...new TextEncoder().encode(section),
			1
		])
	]);

beforeEach(() => {
	backendRuntime.compileBitcodeArtifact.mockReset();
	backendRuntime.compileBitcodeArtifact.mockResolvedValue(dwarfModule());
});

describe('Zig debug bitcode compilation', () => {
	it("preserves Zig WASI's 16 MiB default stack without relaxing the requested memory limit", async () => {
		const bitcode = [new Uint8Array([0x42, 0x43, 0xc0, 0xde])];
		const maxWasmMemoryBytes = 128 * 1024 * 1024;
		await compileZigDebugArtifact({
			bitcode,
			sources: [{ path: '/workspace/main.zig', content: 'pub fn main() void {}' }],
			zigReceipts: { 'zig_small.wasm': receipt, 'std.tar.gz': receipt },
			backend: snapshotZigDebugBackend(
				'https://assets.example.test/clang/',
				{ 'runtime-manifest.v1.json': receipt },
				1024 * 1024,
				maxWasmMemoryBytes
			),
			log: false
		});
		expect(backendRuntime.compileBitcodeArtifact).toHaveBeenCalledWith(bitcode, {
			stackSizeBytes: 16 * 1024 * 1024,
			maxWasmMemoryBytes
		});
	});
});
