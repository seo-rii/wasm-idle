// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaygroundBinding } from '../playground/sandbox.js';
import type { ContainerWorkerRequest, ContainerWorkerResponse } from './protocol.js';
import type { ContainerWorkerOptions } from './owner-worker.js';
import type { BashProfileOptions } from './bash-profile.js';
import { SHELL_CONTROL_ROUTE, SHELL_RESIZE_REQUEST } from './shell-control.js';

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

async function shellInputFixture() {
	const { createContainer } = await import('@wasm-idle/container');
	const container = createContainer();
	const bytes: Uint8Array[] = [];
	let releaseWrite!: () => void;
	const blocked = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const write = vi.fn(async (value: Uint8Array) => {
		bytes.push(value.slice());
		await blocked;
	});
	const close = vi.fn();
	const resize = vi.fn(async () => {});
	let onInvocation: BashProfileOptions['onInvocation'];
	let finish!: (value: { code: number; reason: 'exited' }) => void;
	const empty = () =>
		new ReadableStream<Uint8Array>({
			start(c) {
				c.close();
			}
		});
	const shell = {
		resize,
		stdin: new WritableStream<Uint8Array>({ write, close }),
		stdout: empty(),
		stderr: empty(),
		exited: new Promise<{ code: number; reason: 'exited' }>((resolve) => {
			finish = resolve;
		}),
		dispose: async () => {
			finish({ code: 0, reason: 'exited' });
		}
	};
	const startShell = vi.fn(async () => shell);
	vi.doMock('./bash-profile.js', () => ({
		createBashProfile: async (options: BashProfileOptions) => {
			onInvocation = options.onInvocation;
			return { container, startShell, dispose: () => container.dispose() };
		}
	}));
	const { owner, initialize, postMessage } = await retirementFixture(
		async () =>
			({
				config: { sdkWorkerUrl: 'https://app.test/sdk.worker.js' },
				sdk: {}
			}) as never
	);
	const send = (id: number, method: string, args: unknown[] = []) =>
		(
			globalThis as unknown as {
				onmessage(event: { data: ContainerWorkerRequest }): void;
			}
		).onmessage({
			data: { version: 1, channel: 'retirement-test', id, type: 'call', method, args }
		});
	const response = async (id: number) => {
		await vi.waitFor(() =>
			expect(
				postMessage.mock.calls.some(
					([value]) => value.id === id && ['result', 'error'].includes(value.type)
				)
			).toBe(true)
		);
		return postMessage.mock.calls.find(
			([value]) => value.id === id && ['result', 'error'].includes(value.type)
		)![0];
	};
	return {
		owner,
		initialize,
		container,
		bytes,
		write,
		close,
		resize,
		startShell,
		acknowledgeResize() {
			const path = SHELL_CONTROL_ROUTE;
			const fields = new TextDecoder()
				.decode(container.fs.readFile(SHELL_RESIZE_REQUEST))
				.trim()
				.split(' ');
			onInvocation?.({
				path,
				argv: [path, ...fields, 'ok'],
				cwd: '/workspace',
				env: [],
				stdin: null,
				stdout: null,
				stderr: null
			});
		},
		releaseWrite,
		finish,
		send,
		response
	};
}

describe('application-owned container worker', () => {
	it('passes initial geometry and keeps input independent of serialized resize acknowledgements', async () => {
		const f = await shellInputFixture();
		try {
			f.initialize();
			expect(await f.response(0)).toMatchObject({ type: 'result' });
			f.send(1, 'shellStart', [{ columns: 106, rows: 35 }]);
			expect(await f.response(1)).toMatchObject({ type: 'result' });
			expect(f.startShell).toHaveBeenCalledWith(
				expect.objectContaining({
					columns: 106,
					rows: 35,
					env: expect.objectContaining({ PWD: '/workspace' })
				}),
				expect.any(AbortSignal)
			);
			f.send(2, 'shellResize', [53, 31]);
			await vi.waitFor(() => expect(f.resize).toHaveBeenCalledWith(53, 31));
			f.send(3, 'shellResize', [99, 29]);
			f.send(4, 'shellWrite', ['foreground input\n']);
			await vi.waitFor(() => expect(f.write).toHaveBeenCalledOnce());
			expect(f.resize).toHaveBeenCalledOnce();
			f.releaseWrite();
			expect(await f.response(4)).toMatchObject({ type: 'result' });
			f.acknowledgeResize();
			expect(await f.response(2)).toMatchObject({ type: 'result' });
			await vi.waitFor(() => expect(f.resize).toHaveBeenLastCalledWith(99, 29));
			f.acknowledgeResize();
			expect(await f.response(3)).toMatchObject({ type: 'result' });
		} finally {
			f.releaseWrite();
			await f.owner.dispose();
		}
	});

	it('validates geometry and settles pending, queued and later resizes when Bash exits', async () => {
		const f = await shellInputFixture();
		try {
			f.initialize();
			expect(await f.response(0)).toMatchObject({ type: 'result' });
			f.send(1, 'shellStart', [{ columns: 80 }]);
			expect(await f.response(1)).toMatchObject({ type: 'error' });
			expect(f.startShell).not.toHaveBeenCalled();
			f.send(2, 'shellStart');
			expect(await f.response(2)).toMatchObject({ type: 'result' });
			f.send(3, 'shellResize', [65536, 25]);
			expect(await f.response(3)).toMatchObject({ type: 'error' });
			expect(f.resize).not.toHaveBeenCalled();
			f.send(4, 'shellResize', [90, 30]);
			await vi.waitFor(() => expect(f.resize).toHaveBeenCalledOnce());
			f.send(5, 'shellResize', [53, 30]);
			f.finish({ code: 0, reason: 'exited' });
			expect(await f.response(4)).toMatchObject({ type: 'result' });
			expect(await f.response(5)).toMatchObject({ type: 'result' });
			f.send(6, 'shellResize', [106, 30]);
			expect(await f.response(6)).toMatchObject({ type: 'result' });
			expect(f.resize).toHaveBeenCalledExactlyOnceWith(90, 30);
			f.send(7, 'shellResize', [0, 30]);
			expect(await f.response(7)).toMatchObject({ type: 'error' });
			f.send(8, 'shellWrite', ['after exit']);
			expect(await f.response(8)).toMatchObject({
				type: 'error',
				error: { message: 'Shell is not running' }
			});
		} finally {
			await f.owner.dispose();
		}
	});

	it('settles a resize if the SDK session exits before its output has drained', async () => {
		const f = await shellInputFixture();
		const { ContainerError } = await import('@wasm-idle/container');
		try {
			f.initialize();
			await f.response(0);
			f.send(1, 'shellStart');
			await f.response(1);
			f.resize.mockRejectedValueOnce(new ContainerError('DISPOSED', 'Shell has exited'));
			f.send(2, 'shellResize', [53, 30]);
			expect(await f.response(2)).toMatchObject({ type: 'result' });
			f.send(3, 'inspect');
			expect(await f.response(3)).toMatchObject({
				type: 'result',
				value: { shell: { control: { resizeGeneration: 0 } } }
			});
		} finally {
			await f.owner.dispose();
		}
	});

	it('settles pending, queued and later automatic resizes quietly when EOF closes shell input', async () => {
		const f = await shellInputFixture();
		try {
			f.initialize();
			await f.response(0);
			f.send(1, 'shellStart');
			await f.response(1);
			f.send(2, 'shellResize', [106, 35]);
			await vi.waitFor(() =>
				expect(
					new TextDecoder().decode(f.container.fs.readFile(SHELL_RESIZE_REQUEST))
				).toMatch(/^4 [a-f0-9]{32} 1 resize\n$/)
			);
			f.send(3, 'shellResize', [53, 35]);
			f.send(4, 'shellEof');
			expect(await f.response(4)).toMatchObject({ type: 'result' });
			expect(await f.response(2)).toMatchObject({ type: 'result' });
			expect(await f.response(3)).toMatchObject({ type: 'result' });
			f.send(5, 'shellResize', [80, 25]);
			expect(await f.response(5)).toMatchObject({ type: 'result' });
			expect(f.resize).toHaveBeenCalledExactlyOnceWith(106, 35);
			expect(f.close).toHaveBeenCalledOnce();
			expect(new TextDecoder().decode(f.container.fs.readFile(SHELL_RESIZE_REQUEST))).toMatch(
				/^4 [a-f0-9]{32} 0 resize\n$/
			);
			f.send(6, 'shellWrite', ['still closed']);
			expect(await f.response(6)).toMatchObject({
				type: 'error',
				error: { message: 'Shell input is closed' }
			});
		} finally {
			await f.owner.dispose();
		}
	});

	it.each([false, true])(
		'does not request a redraw after EOF during the size helper (fails: %s)',
		async (fails) => {
			const f = await shellInputFixture();
			let finishResize!: () => void;
			f.resize.mockImplementationOnce(
				() =>
					new Promise<void>((resolve, reject) => {
						finishResize = () =>
							fails ? reject(new Error('TTY helper failed')) : resolve();
					})
			);
			try {
				f.initialize();
				await f.response(0);
				f.send(1, 'shellStart');
				await f.response(1);
				f.send(2, 'shellResize', [106, 35]);
				await vi.waitFor(() => expect(f.resize).toHaveBeenCalledOnce());
				f.send(3, 'shellEof');
				expect(await f.response(3)).toMatchObject({ type: 'result' });
				finishResize();
				expect(await f.response(2)).toMatchObject(
					fails
						? { type: 'error', error: { message: 'TTY helper failed' } }
						: { type: 'result' }
				);
				expect(
					new TextDecoder().decode(f.container.fs.readFile(SHELL_RESIZE_REQUEST))
				).toMatch(/^4 [a-f0-9]{32} 0 resize\n$/);
			} finally {
				finishResize?.();
				await f.owner.dispose();
			}
		}
	);

	it('still delivers real EOF if the control mailbox fails and can retry that control request', async () => {
		const { owner, initialize, container, close, send, response } = await shellInputFixture();
		const mailbox = '/tmp/.wasm-idle-shell-control-request';
		try {
			initialize();
			expect(await response(0)).toMatchObject({ type: 'result' });
			send(1, 'shellStart');
			expect(await response(1)).toMatchObject({ type: 'result' });
			container.fs.unlink(mailbox);
			container.fs.mkdir(mailbox);
			send(2, 'shellEof');
			expect(await response(2)).toMatchObject({
				type: 'error',
				error: { message: expect.stringMatching(/mailbox.*regular file/) }
			});
			expect(close).toHaveBeenCalledOnce();
			container.fs.rmdir(mailbox);
			send(3, 'shellEof');
			expect(await response(3)).toMatchObject({ type: 'result' });
			expect(close).toHaveBeenCalledOnce();
			expect(new TextDecoder().decode(container.fs.readFile(mailbox))).toMatch(
				/^3 [a-f0-9]{32} 1 eof\n$/
			);
		} finally {
			await owner.dispose();
		}
	});

	it('does not latch EOF before shell startup and tolerates exit during real stdin close', async () => {
		const { owner, initialize, close, finish, send, response } = await shellInputFixture();
		try {
			initialize();
			expect(await response(0)).toMatchObject({ type: 'result' });
			send(1, 'shellEof');
			expect(await response(1)).toMatchObject({ type: 'result' });
			expect(close).not.toHaveBeenCalled();
			send(2, 'shellStart');
			expect(await response(2)).toMatchObject({ type: 'result' });
			close.mockImplementationOnce(() => {
				finish({ code: 0, reason: 'exited' });
			});
			send(3, 'shellEof');
			expect(await response(3)).toMatchObject({ type: 'result' });
			send(4, 'shellEof');
			expect(await response(4)).toMatchObject({ type: 'result' });
			expect(close).toHaveBeenCalledOnce();
		} finally {
			await owner.dispose();
		}
	});

	it('drains admitted input before real EOF, leaves terminal EOF control, and rejects later writes', async () => {
		const { owner, initialize, container, bytes, write, close, releaseWrite, send, response } =
			await shellInputFixture();
		try {
			initialize();
			expect(await response(0)).toMatchObject({ type: 'result' });
			send(1, 'shellStart');
			expect(await response(1)).toMatchObject({ type: 'result' });
			send(2, 'shellWrite', ['foreground data\n']);
			await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
			send(3, 'shellEof');
			send(4, 'shellWrite', ['must-not-reach-stdin']);
			expect(await response(4)).toMatchObject({
				type: 'error',
				error: { message: expect.stringMatching(/input.*closed/i) }
			});
			expect(close).not.toHaveBeenCalled();
			releaseWrite();
			expect(await response(2)).toMatchObject({ type: 'result' });
			expect(await response(3)).toMatchObject({ type: 'result' });
			send(5, 'shellEof');
			expect(await response(5)).toMatchObject({ type: 'result' });
			expect(close).toHaveBeenCalledOnce();
			expect(bytes.map((value) => new TextDecoder().decode(value))).toEqual([
				'foreground data\n'
			]);
			expect(
				new TextDecoder().decode(
					container.fs.readFile('/tmp/.wasm-idle-shell-control-request')
				)
			).toMatch(/^3 [a-f0-9]{32} 1 eof\n$/);
		} finally {
			releaseWrite();
			await owner.dispose();
		}
	});

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
