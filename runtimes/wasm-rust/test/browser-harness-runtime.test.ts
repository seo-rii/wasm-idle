import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	isBrowserHarnessProbeSuccessful,
	resolveHarnessTargetTriples
} from '../scripts/browser-harness-runtime.mjs';

describe('browser harness runtime helpers', () => {
	it('treats zero-exit richer stdout as a successful probe by default', () => {
		expect(
			isBrowserHarnessProbeSuccessful([
				{
					ok: true,
					result: {
						compile: { success: true },
						runtime: {
							exitCode: 0,
							stdout: 'preview2_component=preview2-cli\nfactorial_plus_bonus=27\n'
						}
					}
				}
			])
		).toBe(true);
	});

	it('supports an explicit stdout expectation hook when a caller wants exact output', () => {
		expect(
			isBrowserHarnessProbeSuccessful(
				[
					{
						ok: true,
						result: {
							compile: { success: true },
							runtime: {
								exitCode: 0,
								stdout: 'hi\n'
							}
						}
					}
				],
				'hi\n'
			)
		).toBe(true);
		expect(
			isBrowserHarnessProbeSuccessful(
				[
					{
						ok: true,
						result: {
							compile: { success: true },
							runtime: {
								exitCode: 0,
								stdout: 'preview2_component=preview2-cli\nfactorial_plus_bonus=27\n'
							}
						}
					}
				],
				'hi\n'
			)
		).toBe(false);
	});

	it('falls back to the legacy manifest target when v2/v3 manifests are absent', async () => {
		const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-harness-targets-'));
		await fs.mkdir(path.join(projectRoot, 'dist', 'runtime'), { recursive: true });
		await fs.writeFile(
			path.join(projectRoot, 'dist', 'runtime', 'runtime-manifest.json'),
			JSON.stringify({
				targetTriple: 'wasm32-wasip1'
			})
		);

		try {
			await expect(resolveHarnessTargetTriples(projectRoot)).resolves.toEqual(['wasm32-wasip1']);
		} finally {
			await fs.rm(projectRoot, { recursive: true, force: true });
		}
	});
});
