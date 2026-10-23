import { describe, expect, it, vi } from 'vitest';
import { checkRust, compileRust } from '../src/compiler.js';
import { buildRustcArguments, parseRustcCheckDiagnostics } from '../src/compiler-worker.js';
import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';
import { FakeWorker, createIntegratedRuntimeManifestV3 } from './helpers.js';
import type { CompileWorkerMessage } from '../src/worker-protocol.js';

describe('metadata-only Rust checking', () => {
	it.each(['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'] as const)(
		'accepts successful metadata without linking or component encoding for %s',
		async (targetTriple) => {
			const linkBitcode = vi.fn();
			const worker = new FakeWorker((message, current) => {
				expect(message.request.checkOnly).toBe(true);
				expect(message.sharedBitcodeBuffer.byteLength).toBe(16);
				current.emitMessage({
					type: 'result',
					exitCode: 0,
					stdout: '',
					stderr: '',
					diagnostics: []
				});
			});
			const result = await checkRust(
				{ code: 'fn main() {}', targetTriple },
				{
					loadManifest: async () => createIntegratedRuntimeManifestV3(),
					createWorker: () => worker,
					linkBitcode
				}
			);
			expect(result).toMatchObject({ success: true, diagnostics: [] });
			expect(result).not.toHaveProperty('artifact');
			expect(linkBitcode).not.toHaveBeenCalled();
			expect(worker.terminated).toBe(true);
		}
	);

	it('returns located compiler errors and preserves Run failures', async () => {
		const diagnostics = [
			{ lineNumber: 2, columnNumber: 4, severity: 'error' as const, message: 'expected u32' }
		];
		for (const operation of [checkRust, compileRust]) {
			const result = await operation(
				{ code: 'fn main() { let n: u32 = "x"; }' },
				{
					loadManifest: async () => createIntegratedRuntimeManifestV3(),
					createWorker: () =>
						new FakeWorker((_, worker) =>
							worker.emitMessage({
								type: 'result',
								exitCode: 1,
								stdout: '',
								stderr: 'expected u32',
								diagnostics
							})
						)
				}
			);
			expect(result).toMatchObject({ success: false, diagnostics });
			expect(result).not.toHaveProperty('artifact');
		}
	});

	it('does not treat a timeout or worker failure as a successful check', async () => {
		let now = 0;
		const worker = new FakeWorker();
		const result = await checkRust(
			{ code: 'fn main() {}' },
			{
				loadManifest: async () => createIntegratedRuntimeManifestV3(),
				createWorker: () => worker,
				now: () => now,
				sleep: async () => {
					now += 100_000;
				}
			}
		);
		expect(result).toMatchObject({
			success: false,
			stderr: expect.stringContaining('timed out')
		});
		expect(worker.terminated).toBe(true);
	});

	it.each([
		{ type: 'error', message: 'worker failed' },
		{ type: 'result', exitCode: null, stdout: '', stderr: 'rustc trapped' },
		{ type: 'result', exitCode: 1, stdout: '', stderr: 'metadata rejected' }
	] satisfies CompileWorkerMessage[])(
		'fails and cleans up on $type without requiring an output artifact',
		async (message) => {
			const worker = new FakeWorker((_request, current) => current.emitMessage(message));
			const linkBitcode = vi.fn();
			const result = await checkRust(
				{ code: 'fn main() {}' },
				{
					loadManifest: async () => createIntegratedRuntimeManifestV3(),
					createWorker: () => worker,
					linkBitcode
				}
			);
			expect(result.success).toBe(false);
			expect(result).not.toHaveProperty('artifact');
			expect(worker.terminated).toBe(true);
			expect(linkBitcode).not.toHaveBeenCalled();
		}
	);

	it('uses the metadata output contract and parses rustc JSON locations', () => {
		const args = buildRustcArguments(
			{ code: 'fn main() {}', checkOnly: true },
			normalizeRuntimeManifest(createIntegratedRuntimeManifestV3())
		);
		expect(args).toEqual(
			expect.arrayContaining(['--emit=metadata', '--error-format=json', '/work/check.rmeta'])
		);
		expect(args).not.toContain('--emit=link');
		const diagnostic = {
			$message_type: 'diagnostic',
			message: 'mismatched types',
			level: 'error',
			spans: [{ is_primary: true, line_start: 3, column_start: 7 }]
		};
		expect(
			parseRustcCheckDiagnostics(
				[
					'non-JSON runtime message',
					JSON.stringify(diagnostic),
					JSON.stringify({
						$message_type: 'diagnostic',
						message: 'aborting due to 1 previous error',
						level: 'error',
						spans: []
					})
				].join('\n')
			)
		).toEqual([
			{ lineNumber: 3, columnNumber: 7, severity: 'error', message: 'mismatched types' }
		]);
	});
});
