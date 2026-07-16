import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	RUNTIMES,
	assertAllRuntimeSyncArgs,
	assertRuntimeSyncArgs,
	runtimeListLine,
	runtimesForAll
} from '../../scripts/sync-runtime.mjs';

describe('sync-runtime registry', () => {
	it('registers the wasm-llvm-produced COBOL asset synchronizer', () => {
		expect(RUNTIMES.find((runtime) => runtime.name === 'wasm-cobol')).toMatchObject({
			module: './sync-wasm-cobol.mjs',
			exportName: 'syncWasmCobolAssets',
			sourceArg: 'sourceDir',
			targetArg: 'targetDir'
		});
	});

	it('marks Swift as a manual runtime candidate', () => {
		const swiftRuntime = RUNTIMES.find((runtime) => runtime.name === 'wasm-swift');

		expect(swiftRuntime).toMatchObject({
			name: 'wasm-swift',
			module: './sync-wasm-swift.mjs',
			exportName: 'syncWasmSwiftAssets',
			manual: true
		});
		expect(runtimeListLine(swiftRuntime!)).toBe('wasm-swift\tmanual');
	});

	it('excludes manual runtimes from all-sync unless explicitly requested', () => {
		const automaticRuntimeNames = runtimesForAll().map((runtime) => runtime.name);

		expect(automaticRuntimeNames).not.toContain('wasm-swift');
		expect(
			runtimesForAll({ includeManual: false }).map((runtime) => runtime.name)
		).not.toContain('wasm-swift');
		expect(runtimesForAll({ includeManual: true }).map((runtime) => runtime.name)).toContain(
			'wasm-swift'
		);
		for (const runtime of RUNTIMES.filter((candidate) => candidate.manual)) {
			expect(automaticRuntimeNames).not.toContain(runtime.name);
		}
	});

	it('rejects extra direct runtime sync arguments before dispatching manual Swift sync', () => {
		expect(() => assertRuntimeSyncArgs([])).not.toThrow();
		expect(() => assertRuntimeSyncArgs(['source', 'target'])).not.toThrow();
		expect(() => assertRuntimeSyncArgs(['source', 'target', 'extra'])).toThrow(
			/at most sourceDir and targetDir/u
		);
		expect(() => assertRuntimeSyncArgs(['--unknown'])).toThrow(
			/Unknown option for runtime sync/u
		);
	});

	it('rejects unknown all-sync arguments before dispatching manual runtimes', () => {
		expect(() => assertAllRuntimeSyncArgs([])).not.toThrow();
		expect(() => assertAllRuntimeSyncArgs(['--unknown'])).toThrow(
			/Unknown option for all runtime sync/u
		);
		expect(() => assertAllRuntimeSyncArgs(['source'])).toThrow(
			/Unknown option for all runtime sync/u
		);
	});

	it('reports runtime sync dispatcher argument errors without stack traces', () => {
		const result = spawnSync(
			process.execPath,
			['scripts/sync-runtime.mjs', 'wasm-swift', 'source', 'target', 'extra'],
			{ encoding: 'utf8' }
		);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/at most sourceDir and targetDir/u);
		expect(result.stderr).not.toMatch(/\n\s+at /u);
	});

	it('lists Swift as manual in the runtime sync CLI output', () => {
		const implicitList = spawnSync(process.execPath, ['scripts/sync-runtime.mjs'], {
			encoding: 'utf8'
		});
		const explicitList = spawnSync(process.execPath, ['scripts/sync-runtime.mjs', 'list'], {
			encoding: 'utf8'
		});

		for (const result of [implicitList, explicitList]) {
			expect(result.status).toBe(0);
			expect(result.stdout).toContain('wasm-swift\tmanual');
			expect(result.stdout).not.toContain('wasm-swift\n');
			expect(result.stderr).toBe('');
		}
	});

	it('reports all-sync argument errors without stack traces', () => {
		const result = spawnSync(
			process.execPath,
			['scripts/sync-runtime.mjs', 'all', '--include-manual', '--unknown'],
			{ encoding: 'utf8' }
		);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/Unknown option for all runtime sync: --unknown/u);
		expect(result.stderr).not.toMatch(/\n\s+at /u);
	});
});
