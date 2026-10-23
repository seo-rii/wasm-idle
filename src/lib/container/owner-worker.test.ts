// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaygroundBinding } from '../playground/sandbox.js';
import type { ContainerWorkerRequest, ContainerWorkerResponse } from './protocol.js';
import type { ContainerWorkerOptions } from './owner-worker.js';

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.unstubAllGlobals();
	vi.doUnmock('./bash-profile.js');
});

async function retirementFixture(
	createBashConfiguration: ContainerWorkerOptions['createBashConfiguration']
) {
	vi.stubGlobal(
		'Worker',
		class extends EventTarget {
			terminate() {}
		}
	);
	vi.stubGlobal('location', {
		origin: 'https://app.test',
		href: 'https://app.test/assets/owner.js'
	});
	vi.stubGlobal('crossOriginIsolated', true);
	vi.stubGlobal('onmessage', null);
	const postMessage = vi.fn();
	vi.stubGlobal('postMessage', postMessage);
	const { serveContainerWorker } = await import('./owner-worker.js');
	const owner = serveContainerWorker({
		languages: ['C'],
		createBinding: vi.fn(),
		createBashConfiguration
	});
	// Retain the handler to model a message that was already queued on retirement.
	const receive = (
		globalThis as unknown as {
			onmessage(event: { data: ContainerWorkerRequest }): void;
		}
	).onmessage;
	const initialize = () =>
		receive({
			data: {
				version: 1,
				channel: 'retirement-test',
				id: 0,
				type: 'init',
				settings: {
					runtimeAssets: './runtime/',
					applicationRootURL: 'https://app.test/app/',
					workspaceId: 'retirement'
				}
			}
		});
	return { owner, initialize, postMessage };
}

describe('application-owned container worker', () => {
	it('imports the public entry without starting workers, fetching assets, or changing the realm', async () => {
		const worker = vi.fn();
		const fetcher = vi.fn();
		vi.stubGlobal('Worker', worker);
		vi.stubGlobal('fetch', fetcher);
		const entry = await import('./index.js');
		expect(entry.createContainerPlaygroundBinding).toBeTypeOf('function');
		expect(entry.serveContainerWorker).toBeTypeOf('function');
		expect(globalThis.Worker).toBe(worker);
		expect(worker).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	}, 15_000);

	it('runs the injected engine against source snapshots and retires every owned child', async () => {
		const terminated = vi.fn();
		class ChildWorker extends EventTarget {
			terminate = terminated;
		}
		vi.stubGlobal('Worker', ChildWorker);
		vi.stubGlobal('location', {
			origin: 'https://app.test',
			href: 'https://app.test/assets/owner.js'
		});
		vi.stubGlobal('crossOriginIsolated', false);
		vi.stubGlobal('onmessage', null);
		const responses: ContainerWorkerResponse[] = [];
		vi.stubGlobal('postMessage', (message: ContainerWorkerResponse) => responses.push(message));
		let boundAssets: unknown;
		const run = vi.fn(async () => true);
		const createBinding = vi.fn((assets) => {
			boundAssets = assets;
			new Worker('https://app.test/engine.js');
			return {
				load: async () => ({ run, terminate: vi.fn(), clear: vi.fn(), eof: vi.fn() }),
				dispose: vi.fn()
			} as unknown as PlaygroundBinding;
		});
		const createBashConfiguration = vi.fn();
		const { serveContainerWorker } = await import('./owner-worker.js');
		const owner = serveContainerWorker({
			languages: ['PYTHON3'],
			createBinding,
			createBashConfiguration
		});
		const send = (request: ContainerWorkerRequest) =>
			(
				globalThis as unknown as {
					onmessage(event: { data: ContainerWorkerRequest }): void;
				}
			).onmessage({ data: request });
		const wait = async (id: number) => {
			await vi.waitFor(() =>
				expect(
					responses.some((message) => message.id === id && message.type === 'result')
				).toBe(true)
			);
			return responses.find((message) => message.id === id && message.type === 'result')!;
		};
		const call = async (id: number, method: string, args: unknown[] = []) => {
			send({ version: 1, channel: 'test-owner', id, type: 'call', method, args });
			return await wait(id);
		};
		try {
			send({
				version: 1,
				channel: 'test-owner',
				id: 0,
				type: 'init',
				settings: {
					runtimeAssets: './runtime/',
					applicationRootURL: 'https://app.test/app/',
					workspaceId: 'test'
				}
			});
			await wait(0);
			expect(createBashConfiguration).not.toHaveBeenCalled();
			expect(createBinding).not.toHaveBeenCalled();
			await call(1, 'syncWorkspace', [
				'PYTHON3',
				[{ path: 'main.py', content: 'print(42)' }]
			]);
			expect(await call(2, 'run', ['PYTHON3', 'print(42)', false, [], {}])).toMatchObject({
				type: 'result',
				value: true
			});
			expect(boundAssets).toBe('https://app.test/app/runtime/');
			expect(run).toHaveBeenCalledOnce();
			expect(await call(3, 'readWorkspace', ['PYTHON3'])).toMatchObject({
				value: [{ path: 'main.py', content: new TextEncoder().encode('print(42)') }]
			});
			expect(await call(4, 'inspect')).toMatchObject({ value: { ownedWorkers: 1 } });
			await call(5, 'dispose');
			expect(terminated).toHaveBeenCalledOnce();
			expect(() => new Worker('https://app.test/late.js')).toThrow(/admission limit/);
		} finally {
			await owner.dispose();
		}
	});

	it('ignores an initialization message queued after public disposal', async () => {
		const configure = vi.fn();
		const { owner, initialize, postMessage } = await retirementFixture(configure);
		await owner.dispose();
		initialize();
		await Promise.resolve();
		expect(configure).not.toHaveBeenCalled();
		expect(globalThis.onmessage).toBeNull();
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('disposes without waiting for application configuration and rejects its late continuation', async () => {
		let resolve!: (
			configuration: Awaited<ReturnType<ContainerWorkerOptions['createBashConfiguration']>>
		) => void;
		const configure = vi.fn(
			() =>
				new Promise<Awaited<ReturnType<ContainerWorkerOptions['createBashConfiguration']>>>(
					(yes) => {
						resolve = yes;
					}
				)
		);
		const profile = vi.fn();
		vi.doMock('./bash-profile.js', () => ({ createBashProfile: profile }));
		const { owner, initialize, postMessage } = await retirementFixture(configure);
		initialize();
		expect(configure).toHaveBeenCalledOnce();
		// This must settle while the external application promise is still unresolved.
		await owner.dispose();
		resolve({ config: { sdkWorkerUrl: 'https://app.test/sdk.worker.js' }, sdk: {} } as never);
		await Promise.resolve();
		await Promise.resolve();
		expect(profile).not.toHaveBeenCalled();
		expect(postMessage).not.toHaveBeenCalled();
		expect(() => new Worker('https://app.test/late.js')).toThrow(/admission limit/);
	});

	it('cleans a profile and SDK group that complete after owner disposal', async () => {
		const lateDispose = vi.fn(async () => {});
		let resolve!: (profile: { dispose(): Promise<void> }) => void;
		const profile = vi.fn(
			() =>
				new Promise<{ dispose(): Promise<void> }>((yes) => {
					resolve = yes;
				})
		);
		vi.doMock('./bash-profile.js', () => ({ createBashProfile: profile }));
		const configure = vi.fn(
			async () =>
				({
					config: { sdkWorkerUrl: 'https://app.test/sdk.worker.js' },
					sdk: {}
				}) as never
		);
		const { owner, initialize, postMessage } = await retirementFixture(configure);
		initialize();
		await vi.waitFor(() => expect(profile).toHaveBeenCalledOnce());
		const group = (
			profile.mock.calls[0] as unknown as [
				{ workerGroup: { inspect(): { disposed: boolean } } }
			]
		)[0].workerGroup;
		await owner.dispose();
		resolve({ dispose: lateDispose });
		await vi.waitFor(() => {
			expect(lateDispose).toHaveBeenCalledOnce();
			expect(group.inspect().disposed).toBe(true);
		});
		expect(postMessage).not.toHaveBeenCalled();
	});
});
