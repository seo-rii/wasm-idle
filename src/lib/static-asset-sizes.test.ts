import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	checkStaticAssetBudgets,
	formatStaticAssetReport,
	measureStaticAssets,
	parseStaticAssetBudgets
} from '../../scripts/static-asset-sizes.mjs';

const tempDirs: string[] = [];

async function makeTestRoot(prefix: string) {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
	tempDirs.push(rootDir);
	return rootDir;
}

async function writeAsset(rootDir: string, relativePath: string, size: number) {
	const filePath = path.join(rootDir, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, Buffer.alloc(size));
}

function budgets(
	overrides: Record<string, { maxBytes: number; maxFiles: number; optional?: boolean }> = {}
) {
	return parseStaticAssetBudgets({
		schemaVersion: 1,
		total: { maxBytes: 1000, maxFiles: 10 },
		directories: {
			'wasm-rust': { maxBytes: 800, maxFiles: 5 },
			...overrides
		}
	});
}

describe('static asset size budgets', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((rootDir) => rm(rootDir, { recursive: true })));
	});

	it('measures runtime directories and precompressed bytes', async () => {
		const rootDir = await makeTestRoot('static-asset-sizes');
		await writeAsset(rootDir, 'wasm-rust/rustc.wasm.gz', 300);
		await writeAsset(rootDir, 'wasm-rust/runtime.wasm.gz.bin', 50);
		await writeAsset(rootDir, 'wasm-rust/index.js', 100);
		await writeAsset(rootDir, 'robots.txt', 20);

		const measurement = await measureStaticAssets(rootDir);

		expect(measurement.total).toEqual({ bytes: 470, compressedBytes: 350, files: 4 });
		expect(measurement.directories['wasm-rust']).toEqual({
			bytes: 450,
			compressedBytes: 350,
			files: 3
		});
		expect(formatStaticAssetReport(measurement)).toContain('wasm-rust: 0.00 MiB, 3 files');
		expect(checkStaticAssetBudgets(measurement, budgets())).toEqual([]);
	});

	it('reports exceeded and missing runtime budgets', async () => {
		const rootDir = await makeTestRoot('static-asset-budget-errors');
		await writeAsset(rootDir, 'wasm-rust/rustc.wasm.gz', 900);
		await writeAsset(rootDir, 'wasm-new/runtime.wasm.gz', 200);

		const measurement = await measureStaticAssets(rootDir);
		const violations = checkStaticAssetBudgets(measurement, budgets());

		expect(violations).toContain('static uses 1100 bytes; budget is 1000');
		expect(violations).toContain('wasm-rust uses 900 bytes; budget is 800');
		expect(violations).toContain('wasm-new has runtime assets but no directory budget');
	});

	it('rejects stale directory budgets', async () => {
		const rootDir = await makeTestRoot('static-asset-stale-budget');
		await writeAsset(rootDir, 'wasm-rust/rustc.wasm.gz', 10);
		const measurement = await measureStaticAssets(rootDir);

		expect(
			checkStaticAssetBudgets(
				measurement,
				budgets({ 'wasm-removed': { maxBytes: 10, maxFiles: 1 } })
			)
		).toContain('wasm-removed has an asset budget but no directory');
	});

	it('allows explicitly optional generated runtime directories to be absent', async () => {
		const rootDir = await makeTestRoot('static-asset-optional-budget');
		await writeAsset(rootDir, 'wasm-rust/rustc.wasm.gz', 10);
		const measurement = await measureStaticAssets(rootDir);

		expect(
			checkStaticAssetBudgets(
				measurement,
				budgets({ 'wasm-debug': { maxBytes: 20, maxFiles: 1, optional: true } })
			)
		).toEqual([]);
	});
});
