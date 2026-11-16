// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncWasmAplAssets } from '../../scripts/sync-wasm-apl.mjs';
import { WASM_APL_INTERPRETER } from './playground/wasmAplVersion';

describe('pinned GNU APL distribution', () => {
	it('verifies the original engine, complete input inventory and committed profile', async () => {
		await expect(syncWasmAplAssets({ check: true })).resolves.toMatchObject({
			bytes: WASM_APL_INTERPRETER.bytes,
			sha256: WASM_APL_INTERPRETER.sha256
		});
		const bytes = await readFile('static/wasm-apl/apl.wasm');
		expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_APL_INTERPRETER.sha256);
		const module = new WebAssembly.Module(bytes);
		expect(
			WebAssembly.Module.imports(module).every(
				(item) => item.module === 'wasi_snapshot_preview1'
			)
		).toBe(true);
		expect(WebAssembly.Module.exports(module)).toContainEqual({
			name: '_start',
			kind: 'function'
		});
	});

	it('rejects a stale profile and changed runtime bytes before accepting a distribution', async () => {
		const temporary = await mkdtemp(path.join(tmpdir(), 'wasm-idle-apl-assets-'));
		const targetDir = path.join(temporary, 'assets');
		const versionModulePath = path.join(temporary, 'wasmAplVersion.ts');
		try {
			await syncWasmAplAssets({ sourceDir: 'static/wasm-apl', targetDir, versionModulePath });
			await writeFile(versionModulePath, '// stale\n');
			await expect(
				syncWasmAplAssets({ check: true, targetDir, versionModulePath })
			).rejects.toThrow(/runtime is stale/u);
			const wasm = await readFile(path.join(targetDir, 'apl.wasm'));
			wasm[wasm.length - 1] ^= 1;
			await writeFile(path.join(targetDir, 'apl.wasm'), wasm);
			await expect(
				syncWasmAplAssets({ check: true, targetDir, versionModulePath })
			).rejects.toThrow(/apl.wasm does not match/u);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	it('rejects an incomplete or altered producer recipe inventory', async () => {
		const temporary = await mkdtemp(path.join(tmpdir(), 'wasm-idle-apl-inputs-'));
		try {
			const manifest = JSON.parse(
				await readFile('static/wasm-apl/runtime-build.json', 'utf8')
			);
			delete manifest.inputs['port/wasi-host.cc'];
			await writeFile(path.join(temporary, 'runtime-build.json'), JSON.stringify(manifest));
			await expect(syncWasmAplAssets({ sourceDir: temporary })).rejects.toThrow(
				/input inventory is incomplete/u
			);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
});
