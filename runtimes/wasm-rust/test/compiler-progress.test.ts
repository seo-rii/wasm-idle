import { describe, expect, it } from 'vitest';

import { compileRust, type BrowserRustCompileProgress } from '../src/compiler.js';
import { FakeWorker, createRuntimeManifest, mirrorBitcode } from './helpers.js';

function collapseProgressStages(events: BrowserRustCompileProgress[]) {
	const stages: string[] = [];
	for (const event of events) {
		if (stages[stages.length - 1] !== event.stage) {
			stages.push(event.stage);
		}
	}
	return stages;
}

describe('compileRust progress contract', () => {
	it('reports staged progress in order and only reaches 100 once the artifact is ready', async () => {
		const progressEvents: BrowserRustCompileProgress[] = [];
		const bitcode = new Uint8Array([1, 2, 3, 4]);
		const worker = new FakeWorker((message, currentWorker) => {
			expect((message.request as { onProgress?: unknown }).onProgress).toBeUndefined();
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'fetch-rustc',
					completed: 0,
					total: 1,
					message: 'fetching rustc.wasm'
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'fetch-rustc',
					completed: 1,
					total: 1,
					message: 'rustc.wasm ready',
					bytesCompleted: 1024,
					bytesTotal: 1024
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'fetch-sysroot',
					completed: 0,
					total: 2,
					message: 'fetching sysroot assets'
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'fetch-sysroot',
					completed: 2,
					total: 2,
					message: 'sysroot ready'
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'prepare-fs',
					completed: 1,
					total: 1,
					message: 'filesystem ready'
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'init-thread-pool',
					completed: 4,
					total: 4,
					message: 'helper threads ready'
				}
			});
			currentWorker.emitMessage({
				type: 'progress',
				progress: {
					stage: 'rustc-main',
					completed: 1,
					total: 1,
					message: 'frontend finished'
				}
			});
			mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
			currentWorker.emitMessage({
				type: 'result',
				exitCode: 0,
				stdout: 'worker stdout',
				stderr: ''
			});
		});

		const result = await compileRust(
			{
				code: 'fn main() { println!("hi"); }',
				edition: '2024',
				crateType: 'bin',
				onProgress: (event) => {
					progressEvents.push(event);
				}
			},
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker,
				linkBitcode: async (_bitcode, _manifest, _target, _runtimeBaseUrl, options) => {
					options?.onProgress?.({
						stage: 'link',
						completed: 0,
						total: 2,
						message: 'fetching llc.wasm',
						bytesCompleted: 128,
						bytesTotal: 1024
					});
					options?.onProgress?.({
						stage: 'link',
						completed: 0,
						total: 2,
						message: 'fetching llc.wasm',
						bytesCompleted: 1024,
						bytesTotal: 1024
					});
					options?.onProgress?.({
						stage: 'componentize',
						completed: 0,
						total: 1,
						message: 'encoding preview2 component',
						bytesCompleted: 256,
						bytesTotal: 512
					});
					return {
						wasm: new Uint8Array([9, 8, 7]),
						targetTriple: 'wasm32-wasip1',
						format: 'core-wasm'
					};
				}
			}
		);

		expect(result.success).toBe(true);
		expect(collapseProgressStages(progressEvents)).toEqual([
			'manifest',
			'fetch-rustc',
			'fetch-sysroot',
			'prepare-fs',
			'init-thread-pool',
			'rustc-main',
			'await-bitcode',
			'link',
			'componentize',
			'done'
		]);
		expect(progressEvents.at(-1)?.stage).toBe('done');
		expect(progressEvents.at(-1)?.percent).toBe(100);
		expect(progressEvents.slice(0, -1).every((event) => event.percent < 100)).toBe(true);
		for (let index = 1; index < progressEvents.length; index += 1) {
			expect(progressEvents[index]?.percent).toBeGreaterThanOrEqual(
				progressEvents[index - 1]?.percent || 0
			);
		}
		expect(
			progressEvents.some((event) => event.stage === 'await-bitcode' && event.completed === 1)
		).toBe(true);
		expect(
			progressEvents.find((event) => event.stage === 'await-bitcode' && event.completed === 0)
				?.percent
		).toBeLessThan(60);
		expect(
			progressEvents.find((event) => event.stage === 'link' && event.bytesCompleted === 128)
				?.percent
		).toBeGreaterThan(68);
		expect(
			progressEvents.find((event) => event.stage === 'link' && event.bytesCompleted === 128)
				?.percent
		).toBeLessThan(95);
		expect(
			progressEvents.find(
				(event) => event.stage === 'componentize' && event.bytesCompleted === 256
			)?.percent
		).toBeGreaterThan(95);
	});

	it('keeps progress monotonic across retries and exposes the next attempt', async () => {
		const progressEvents: BrowserRustCompileProgress[] = [];
		const bitcode = new Uint8Array([4, 2, 4, 2]);
		const workers = [
			new FakeWorker((_, currentWorker) => {
				currentWorker.emitMessage({
					type: 'error',
					message: 'memory access out of bounds'
				});
			}),
			new FakeWorker((message, currentWorker) => {
				currentWorker.emitMessage({
					type: 'progress',
					progress: {
						stage: 'fetch-rustc',
						completed: 1,
						total: 1,
						message: 'rustc.wasm ready'
					}
				});
				mirrorBitcode(message.sharedBitcodeBuffer, bitcode);
				currentWorker.emitMessage({
					type: 'result',
					exitCode: 0,
					stdout: '',
					stderr: ''
				});
			})
		];
		let nextWorker = 0;

		const result = await compileRust(
			{
				code: 'fn main() { println!("retry"); }',
				edition: '2024',
				crateType: 'bin',
				onProgress: (event) => {
					progressEvents.push(event);
				}
			},
			{
				loadManifest: async () =>
					createRuntimeManifest({
						compileTimeoutMs: 1_000,
						artifactIdleMs: 200
					}),
				createWorker: () => workers[nextWorker++]!,
				linkBitcode: async () => ({
					wasm: new Uint8Array([1, 1, 2, 3]),
					targetTriple: 'wasm32-wasip1',
					format: 'core-wasm'
				})
			}
		);

		expect(result.success).toBe(true);
		expect(progressEvents.some((event) => event.stage === 'retry' && event.attempt === 2)).toBe(
			true
		);
		for (let index = 1; index < progressEvents.length; index += 1) {
			expect(progressEvents[index]?.percent).toBeGreaterThanOrEqual(
				progressEvents[index - 1]?.percent || 0
			);
		}
		expect(progressEvents.at(-1)?.stage).toBe('done');
		expect(progressEvents.at(-1)?.percent).toBe(100);
	});
});
