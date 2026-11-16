// @vitest-environment node
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	capVerilogWasmMemory,
	createVerilogStdin,
	verilogWorkspacePath
} from '../../scripts/runtime-workers/verilog-host.mjs';
import { syncWasmVerilogAssets } from '../../scripts/sync-wasm-verilog.mjs';
import { compressStaticRuntimeAssets } from '../../scripts/compress-static-runtime-assets.mjs';

describe('original Icarus Verilog distribution', () => {
	it('verifies the committed original assets, build recipe and generated host/profile', async () => {
		await syncWasmVerilogAssets({ check: true });
	});
	it('preserves verified executable URLs through the actual production compressor', async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-verilog-production-'));
		const targetDir = path.join(temp, 'wasm-verilog');
		const versionModulePath = path.join(temp, 'version.ts');
		try {
			await cp('static/wasm-verilog', targetDir, { recursive: true });
			await syncWasmVerilogAssets({ targetDir, versionModulePath });
			await compressStaticRuntimeAssets({ rootDir: temp });
			await syncWasmVerilogAssets({ check: true, targetDir, versionModulePath });
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
	it('rejects corrupted upstream code before writing generated output', async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-verilog-pin-'));
		try {
			await cp('static/wasm-verilog', temp, { recursive: true });
			const bytes = gunzipSync(await readFile(path.join(temp, 'ivl.wasm.gz.bin')));
			bytes[bytes.length - 1] ^= 1;
			await (
				await import('node:fs/promises')
			).writeFile(path.join(temp, 'ivl.wasm.gz.bin'), gzipSync(bytes));
			await expect(syncWasmVerilogAssets({ check: true, targetDir: temp })).rejects.toThrow(
				'pinned asset changed'
			);
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
	it.each(['ivlpp', 'ivl', 'vvp'])(
		'bounds the original %s Wasm without changing instructions',
		async (name) => {
			const bytes = new Uint8Array(
				gunzipSync(await readFile(`static/wasm-verilog/${name}.wasm.gz.bin`))
			);
			const original = new WebAssembly.Module(bytes);
			const bounded = new WebAssembly.Module(capVerilogWasmMemory(bytes, 64 * 1024 * 1024));
			expect(WebAssembly.Module.imports(bounded)).toEqual(
				WebAssembly.Module.imports(original)
			);
			expect(WebAssembly.Module.exports(bounded)).toEqual(
				WebAssembly.Module.exports(original)
			);
			const imports: Record<string, Record<string, () => number>> = {};
			for (const entry of WebAssembly.Module.imports(bounded)) {
				expect(entry.kind).toBe('function');
				(imports[entry.module] ??= {})[entry.name] = () => 0;
			}
			const instance = new WebAssembly.Instance(bounded, imports);
			expect(() => (instance.exports.memory as WebAssembly.Memory).grow(1025)).toThrow(
				RangeError
			);
			expect(() => capVerilogWasmMemory(bytes, 65536)).toThrow('below the stage minimum');
		}
	);
	it('preserves UTF-8 stdin bytes and EOF', () => {
		const input = '한글\n';
		const read = createVerilogStdin(input, undefined, () => {});
		const expected = new TextEncoder().encode(input);
		for (const byte of expected) expect(read()).toBe(byte);
		expect(read()).toBe(null);
	});
	it('rejects escaping workspace paths and invalid shared input descriptors', () => {
		expect(verilogWorkspacePath('src/main.v')).toBe('/work/src/main.v');
		for (const path of ['../x', '/x', 'a/../b', 'a\\b', 'a//b'])
			expect(() => verilogWorkspacePath(path)).toThrow();
		expect(() => createVerilogStdin('', { protocol: 'other' }, () => {})).toThrow(
			'Invalid Verilog stdin ring'
		);
	});
	it('streams a shared input block without one notification per byte', () => {
		const buffer = new SharedArrayBuffer(16 + 8192);
		new Uint8Array(buffer, 16).fill(65, 0, 4097);
		new Int32Array(buffer, 0, 4).set([4097, 0, 1, 0]);
		let requests = 0;
		const read = createVerilogStdin(
			'',
			{
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 2,
				controlBytes: 16,
				capacity: 8192,
				buffer
			},
			() => requests++
		);
		for (let i = 0; i < 4097; i++) expect(read()).toBe(65);
		expect(read()).toBe(null);
		expect(requests).toBeLessThanOrEqual(3);
	});
});
