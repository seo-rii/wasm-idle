import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGccSharedArtifact } from '../src/shared-run.js';
import { qualifiedAtomicManifest, sharedArtifact } from './atomic-fixtures.js';

// Transport stand-in around real WebAssembly instantiation, not a compiler or parallel-engine proof.
class ProtocolWorker {
	static instances: ProtocolWorker[] = [];
	static mode:
		'normal' | 'hang' | 'trap' | 'malformed' | 'creation-failure' | 'guard' | 'early-result' =
		'normal';
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: unknown = null;
	onmessageerror: unknown = null;
	terminated = 0;
	message: any;
	constructor(readonly url: URL) {
		if (ProtocolWorker.mode === 'creation-failure' && ProtocolWorker.instances.length === 1)
			throw new Error('Worker allocation failed');
		ProtocolWorker.instances.push(this);
	}
	postMessage(message: any) {
		this.message = message;
		void (async () => {
			const instance = await WebAssembly.instantiate(message.module, {
				env: { memory: message.memory }
			});
			if (this.terminated) return;
			(instance.exports.__stack_pointer as WebAssembly.Global).value = message.stackTop;
			this.onmessage?.({ data: { id: message.id, type: 'ready' } });
			if (ProtocolWorker.mode === 'early-result') {
				this.onmessage?.({ data: { id: message.id, type: 'result', value: 1 } });
				return;
			}
			if (ProtocolWorker.mode === 'hang') return;
			const finish = () => {
				if (this.terminated) return;
				if (Atomics.load(new Int32Array(message.gate), 0) !== 1) {
					setTimeout(finish, 1);
					return;
				}
				if (ProtocolWorker.mode === 'guard')
					new Uint8Array(message.memory.buffer)[message.stackTop] = 0;
				if (ProtocolWorker.mode === 'trap')
					this.onmessage?.({
						data: { id: message.id, type: 'error', message: 'unreachable' }
					});
				else if (ProtocolWorker.mode === 'malformed')
					this.onmessage?.({ data: { id: 999, type: 'result', value: 1 } });
				else
					this.onmessage?.({
						data: {
							id: message.id,
							type: 'result',
							value: (instance.exports[message.entry] as Function)(
								...message.arguments
							)
						}
					});
			};
			setTimeout(finish, 0);
		})();
	}
	terminate() {
		this.terminated++;
	}
}

beforeEach(() => {
	ProtocolWorker.instances = [];
	ProtocolWorker.mode = 'normal';
	vi.stubGlobal('Worker', ProtocolWorker);
	vi.stubGlobal('crossOriginIsolated', true);
});
afterEach(() => vi.unstubAllGlobals());
const options = () => ({ workerArguments: [[11], [22]], stackBytes: 4096 });

describe('owned shared Worker cohort', () => {
	it('runs the exact inspected module with disjoint stack globals and returns only copied memory', async () => {
		const result = await runGccSharedArtifact(
			sharedArtifact(),
			options(),
			qualifiedAtomicManifest()
		);
		expect(result.values).toEqual([11, 22]);
		expect(Object.isFrozen(result.values)).toBe(true);
		expect(result.memory.buffer).toBeInstanceOf(ArrayBuffer);
		expect(result.peakMemoryBytes).toBe(65536);
		expect(result.stackRegions[0].high).toBeLessThan(result.stackRegions[1].low);
		const [first, second] = ProtocolWorker.instances;
		expect(first.url.pathname).toMatch(/shared-worker-entry\.js$/);
		expect(first.message.memory).toBe(second.message.memory);
		expect(first.message.module).toBe(second.message.module);
		expect(first.message.stackTop).not.toBe(second.message.stackTop);
		expect(first.terminated).toBe(1);
		expect(second.terminated).toBe(1);
		result.memory[0] = 255;
		expect(new Uint8Array(first.message.memory.buffer)[0]).toBe(0);
	});
	it('snapshots caller arguments and the profile before its first await', async () => {
		const artifact = {
			...sharedArtifact(),
			sharedMemory: { entry: 'entry', initialPages: 1, maximumPages: 1 }
		};
		const request = options();
		const promise = runGccSharedArtifact(artifact, request, qualifiedAtomicManifest());
		request.workerArguments[0][0] = 100;
		artifact.sharedMemory.entry = 'untrusted';
		artifact.bytes.fill(0);
		expect((await promise).values).toEqual([11, 22]);
	});
	it('rejects a non-isolated realm before creating any Worker or fetching assets', async () => {
		vi.stubGlobal('crossOriginIsolated', false);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		await expect(
			runGccSharedArtifact(sharedArtifact(), options(), qualifiedAtomicManifest())
		).rejects.toThrow(/cross-origin isolation/);
		expect(ProtocolWorker.instances).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('rejects stale metadata, unqualified manifests, bad signatures and oversized stacks before Workers', async () => {
		const manifest = qualifiedAtomicManifest();
		await expect(
			runGccSharedArtifact({ ...sharedArtifact(), atomics: false }, options(), manifest)
		).rejects.toThrow(/opted-in/);
		await expect(
			runGccSharedArtifact(sharedArtifact(), options(), {
				...manifest,
				qualification: { status: 'unverified' }
			})
		).rejects.toThrow(/qualified/);
		await expect(
			runGccSharedArtifact(sharedArtifact({ parameters: 2 }), options(), manifest)
		).rejects.toThrow(/signature/);
		await expect(
			runGccSharedArtifact(sharedArtifact(), { ...options(), stackBytes: 65536 }, manifest)
		).rejects.toThrow(/cannot fit/);
		await expect(
			runGccSharedArtifact(sharedArtifact(), { ...options(), stackBytes: 4097 }, manifest)
		).rejects.toThrow(/16-byte/);
		expect(ProtocolWorker.instances).toHaveLength(0);
	});
	it.each(['trap', 'malformed', 'creation-failure', 'guard', 'early-result'] as const)(
		'discards every owned Worker on %s',
		async (mode) => {
			ProtocolWorker.mode = mode;
			await expect(
				runGccSharedArtifact(sharedArtifact(), options(), qualifiedAtomicManifest())
			).rejects.toThrow();
			expect(ProtocolWorker.instances.length).toBeGreaterThan(0);
			expect(ProtocolWorker.instances.every((worker) => worker.terminated === 1)).toBe(true);
		}
	);
	it('aborts the complete cohort and ignores captured late result callbacks', async () => {
		ProtocolWorker.mode = 'hang';
		const controller = new AbortController();
		const promise = runGccSharedArtifact(
			sharedArtifact(),
			{ ...options(), signal: controller.signal },
			qualifiedAtomicManifest()
		);
		await vi.waitFor(() => expect(ProtocolWorker.instances).toHaveLength(2));
		const late = ProtocolWorker.instances.map((worker) => worker.onmessage!);
		controller.abort();
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		late.forEach((callback, id) => callback({ data: { type: 'result', id, value: 42 } }));
		expect(ProtocolWorker.instances.every((worker) => worker.terminated === 1)).toBe(true);
	});
	it('times out and permanently discards a cohort whose entry never completes', async () => {
		ProtocolWorker.mode = 'hang';
		await expect(
			runGccSharedArtifact(
				sharedArtifact(),
				{ ...options(), timeoutMs: 50 },
				qualifiedAtomicManifest()
			)
		).rejects.toMatchObject({ name: 'TimeoutError' });
		expect(ProtocolWorker.instances).toHaveLength(2);
		expect(ProtocolWorker.instances.every((worker) => worker.terminated === 1)).toBe(true);
	});
});
