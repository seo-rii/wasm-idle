import { createContainer, type Container, type ContainerProcess } from '@wasm-idle/container';
import { installWasixWorkerGroup } from '@wasm-idle/container/adapters/wasix';
import type { ProgressLike, WorkspaceFile } from '@wasm-idle/core';
import { createBashProfile } from '../../../../examples/container/bash-profile.mjs';
import { createWebsiteBashConfiguration } from './release';
import { createShellControl } from './shell-control';
import { playgroundLanguages } from '../../../routes/language-registry';
import { WebsiteRuntimeAdapter } from './runtime-adapter';
import { WebsiteClangRuntime } from './clang-runtime';
import {
	CONTAINER_WORKER_PROTOCOL,
	serializeContainerWorkerError,
	type ContainerWorkerRequest,
	type ContainerWorkerResponse,
	type ContainerWorkerEvent,
	type ContainerWorkerInitialization,
	type ContainerWorkspaceFileMetadata
} from './protocol';
import type { SandboxExecutionOptions } from '../options';
import type { SandboxRuntimeAssets } from '../sandbox';

const scope = globalThis as unknown as {
	postMessage(message: ContainerWorkerResponse): void;
	onmessage: ((event: MessageEvent<ContainerWorkerRequest>) => void) | null;
};
let channel = '',
	initialized = false,
	retired = false;
let container: Container, engines: WebsiteRuntimeAdapter, clang: WebsiteClangRuntime | undefined;
let profile: Awaited<ReturnType<typeof createBashProfile>> | undefined;
let shellControl: ReturnType<typeof createShellControl> | undefined;
let shell: Awaited<ReturnType<NonNullable<typeof profile>['startShell']>> | undefined;
let shellStarting: Promise<void> | undefined,
	shellClosed = false;
let shellWriter: WritableStreamDefaultWriter<Uint8Array> | undefined;
let shellWrites = Promise.resolve();
let watcher: ReadableStreamDefaultReader | undefined;
const lifetime = new AbortController();
const requests = new Map<number, AbortController>();
const executionMode = new Map<string, 'clang' | 'engine'>();
const NativeWorker = globalThis.Worker,
	children = new Set<Worker>();
let childrenClosed = false;
class ApplicationWorker extends NativeWorker {
	constructor(url: string | URL, options?: WorkerOptions) {
		if (childrenClosed || children.size >= 64)
			throw new Error('Application worker admission limit reached');
		super(url, options);
		children.add(this);
	}
	override terminate() {
		if (!children.delete(this)) return;
		super.terminate();
	}
}
// Every engine Worker remains owned even after the one-shot SDK shell realm retires.
globalThis.Worker = ApplicationWorker;
type ResponsePayload<T> = T extends unknown ? Omit<T, 'version' | 'channel' | 'id'> : never;
const respond = (id: number, result: ResponsePayload<ContainerWorkerResponse>) =>
	scope.postMessage({ version: CONTAINER_WORKER_PROTOCOL, channel, id, ...result });
const emit = (event: ContainerWorkerEvent) => {
	if (!retired) respond(event.requestId ?? 0, { type: 'event', event } as never);
};
function absoluteAssets(value: unknown, root: string, key = ''): unknown {
	if (typeof value === 'string')
		return key === '' || /(?:urls?|URLs?)$/i.test(key) ? new URL(value, root).href : value;
	if (Array.isArray(value)) return value.map((item) => absoluteAssets(item, root, key));
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
		return Object.fromEntries(
			Object.entries(value).map(([name, item]) => [name, absoluteAssets(item, root, name)])
		);
	return value;
}
async function initialize(settings: ContainerWorkerInitialization) {
	if (typeof settings.workspaceId !== 'string' || settings.workspaceId.length > 4096)
		throw new Error('Invalid workspace identifier');
	const root = new URL(settings.applicationRootURL);
	if (root.origin !== location.origin || !root.pathname.endsWith('/'))
		throw new Error('Invalid application asset root');
	engines = new WebsiteRuntimeAdapter({
		runtimeAssets: absoluteAssets(settings.runtimeAssets, root.href) as SandboxRuntimeAssets,
		emit
	});
	if (crossOriginIsolated && typeof SharedArrayBuffer === 'function') {
		const { config, sdk } = await createWebsiteBashConfiguration(root.href);
		const sdkScope = { Worker: ApplicationWorker };
		const group = installWasixWorkerGroup({ scope: sdkScope, maxWorkers: 32 });
		const sdkWorkerURL = new URL(config.sdkWorkerUrl).href;
		// Only the fixed SDK thread entry belongs to the SDK's irrevocable lifetime.
		// Its late allocations keep hitting the closed constructor after shell exit.
		const RoutedWorker = function (url: string | URL, options?: WorkerOptions) {
			const Constructor =
				new URL(String(url), location.href).href === sdkWorkerURL
					? sdkScope.Worker
					: ApplicationWorker;
			return new Constructor(url, options);
		} as unknown as typeof Worker;
		Object.setPrototypeOf(RoutedWorker, NativeWorker);
		Object.defineProperty(RoutedWorker, 'prototype', { value: NativeWorker.prototype });
		globalThis.Worker = RoutedWorker;
		shellControl = createShellControl({ languages: playgroundLanguages });
		profile = await createBashProfile({
			config,
			sdk,
			workerGroup: group,
			adapters: [engines.adapter, shellControl.adapter],
			commands: { ...engines.commands, ...shellControl.commands },
			shellRoutes: { [shellControl.route.path]: { command: shellControl.route.command } },
			onInvocation: (invocation) => {
				shellControl?.onInvocation(invocation);
			}
		});
		container = profile.container;
		clang = new WebsiteClangRuntime(profile as never, engines, emit);
	} else
		container = createContainer({
			adapters: [engines.adapter],
			commands: engines.commands,
			maxBytes: 256 * 1024 * 1024,
			maxInodes: 16384,
			maxProcesses: 8,
			maxMemoryBytes: 2 ** 32
		});
	engines.attach(container);
	watcher = container.fs.watch({ maxQueuedEvents: 32, signal: lifetime.signal }).getReader();
	void (async () => {
		try {
			for (;;) {
				const { value, done } = await watcher!.read();
				if (done) break;
				emit({ name: 'workspace', data: value });
			}
		} catch (error) {
			if (!lifetime.signal.aborted)
				emit({ name: 'shell-output', data: { error: String(error) } });
		}
	})();
}
async function startShell(
	options: { cwd?: string; env?: Record<string, string>; args?: string[] } = {}
) {
	if (!profile)
		throw new Error(
			'Interactive shell requires cross-origin isolation. Batch Run is still available.'
		);
	if (shellClosed)
		throw new Error('Bash has exited. Reload this workspace to open a fresh shell.');
	if (shellStarting) return shellStarting;
	shellStarting = (async () => {
		const cwd = options.cwd ?? '/workspace';
		if (!/^\/workspace(?:\/[A-Z][A-Z0-9_]*)?$/.test(cwd))
			throw new Error('Invalid shell directory');
		container.fs.mkdir(cwd, { recursive: true });
		const control = shellControl!.setup(container.fs);
		const initialDirectory =
			cwd === '/workspace'
				? Promise.resolve()
				: shellControl!.requestDirectory(cwd.slice('/workspace/'.length));
		// Keep a rejection observed while the actual SDK startup is still pending.
		void initialDirectory.catch(() => {});
		try {
			shell = await profile!.startShell(
				{
					cwd,
					args: [...control.args],
					mounts: ['/workspace', '/tmp', '/home/user', control.mountPath],
					env: { ...options.env, ...control.env }
				},
				lifetime.signal
			);
		} catch (error) {
			shellControl?.dispose();
			throw error;
		}
		shellWriter = shell.stdin.getWriter();
		const drain = async (stream: ReadableStream<Uint8Array>, name: string) => {
			const reader = stream.getReader();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					emit({ name: 'shell-output', data: { stream: name, bytes: value } });
				}
			} finally {
				reader.releaseLock();
			}
		};
		void Promise.all([
			shell.exited,
			drain(shell.stdout, 'stdout'),
			drain(shell.stderr, 'stderr')
		])
			.then(([result]) => {
				shellClosed = true;
				shellControl?.dispose();
				emit({
					name: 'shell-output',
					data: {
						stream: 'stderr',
						bytes: new TextEncoder().encode(
							`\nShell ${result.reason}; reload to open a new shell.\n`
						)
					}
				});
			})
			.catch((error) => {
				shellClosed = true;
				shellControl?.dispose();
				emit({
					name: 'shell-output',
					data: { error: error instanceof Error ? error.message : String(error) }
				});
			});
		let readyTimeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				initialDirectory,
				new Promise<never>((_, reject) => {
					readyTimeout = setTimeout(
						() =>
							reject(
								new Error(
									'Bash workspace control did not become ready within 10 seconds'
								)
							),
						10_000
					);
				})
			]);
		} catch (error) {
			shellControl?.dispose();
			await shell?.dispose();
			throw error;
		} finally {
			clearTimeout(readyTimeout);
		}
	})();
	return shellStarting;
}
async function shellWrite(text: string | Uint8Array) {
	if (!shellWriter || shellClosed) throw new Error('Shell is not running');
	const bytes =
		typeof text === 'string'
			? new TextEncoder().encode(text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
			: text;
	if (bytes.length > 65536) throw new Error('Terminal input exceeds 64 KiB');
	const next = shellWrites.catch(() => {}).then(() => shellWriter!.write(bytes));
	shellWrites = next;
	await next;
}
async function dispose() {
	if (retired) return;
	retired = true;
	lifetime.abort();
	shellControl?.dispose();
	for (const request of requests.values()) request.abort();
	await Promise.allSettled([
		shell?.dispose(),
		clang?.dispose(),
		engines?.dispose(),
		profile?.dispose(),
		watcher?.cancel()
	]);
	await container?.dispose();
	childrenClosed = true;
	for (const child of [...children]) child.terminate();
}
const debugMethods = new Set([
	'debugCommand',
	'debugPause',
	'setBreakpoints',
	'debugEvaluate',
	'debugVariables',
	'debugScopes',
	'debugFrameScopes',
	'debugFrameName',
	'debugReadMemory',
	'debugWriteMemory',
	'debugDataBreakpointInfo',
	'debugSetDataBreakpoints'
]);
async function call(
	method: string,
	args: unknown[],
	signal: AbortSignal,
	id: number
): Promise<unknown> {
	if (retired && method !== 'dispose') throw new Error('Container owner has been disposed');
	const language = args[0] as string;
	const progress: ProgressLike = {
		set: (value, stage) =>
			respond(id, { type: 'progress', progress: { kind: 'set', value, stage } } as never),
		report: (event) =>
			respond(id, { type: 'progress', progress: { kind: 'report', event } } as never)
	};
	if (['load', 'prepare', 'run'].includes(method)) {
		const [, code = '', log = true, argv = [], rawOptions = {}] = args as [
			string,
			string?,
			boolean?,
			string[]?,
			SandboxExecutionOptions?
		];
		const options = rawOptions ?? {};
		const useClang =
			!!clang &&
			['C', 'CPP'].includes(language) &&
			!options.debug &&
			(!options.debugMode || options.debugMode === 'none');
		executionMode.set(language, useClang ? 'clang' : 'engine');
		if (useClang) {
			if (method === 'load') {
				engines.inputs(language, code, options);
				return;
			}
			return await clang![method as 'prepare' | 'run'](
				language,
				code,
				argv,
				options,
				signal,
				progress,
				id
			);
		}
		return await engines.execute(
			method as 'load' | 'prepare' | 'run',
			language,
			code,
			log,
			argv,
			options,
			signal,
			progress,
			id
		);
	}
	if (debugMethods.has(method)) return await engines.debug(language, method, args.slice(1));
	if (method === 'write' || method === 'eof') {
		const target = executionMode.get(language) === 'clang' && clang ? clang : engines;
		return method === 'write'
			? await target.write(language, args[1] as string)
			: await target.eof(language);
	}
	if (method === 'stop') {
		await Promise.all([clang?.stop(language), engines.stop(language)]);
		return;
	}
	if (method === 'clear') {
		clang?.clear(language);
		if (executionMode.get(language) === 'engine') await engines.clear(language);
		return;
	}
	if (method === 'restart') {
		await clang?.stop(language);
		clang?.clear(language);
		await engines.restart(language);
		return;
	}
	if (method === 'syncWorkspace')
		return engines.syncWorkspace(
			language,
			args[1] as WorkspaceFile[],
			args[2] as WorkspaceFile[] | undefined
		);
	if (method === 'syncWorkspaceDelta') {
		if (!Array.isArray(args[2]) || !Array.isArray(args[3]))
			throw new TypeError('Workspace delta requires a baseline and project metadata');
		return engines.syncWorkspace(
			language,
			args[1] as WorkspaceFile[],
			args[2] as WorkspaceFile[],
			args[3] as ContainerWorkspaceFileMetadata[]
		);
	}
	if (method === 'readWorkspace') return engines.readWorkspace(language);
	if (method === 'readWorkspaceDelta')
		return engines.readWorkspaceDelta(language, args[1] as number | undefined);
	if (method === 'listWorkspaceFiles') return engines.listWorkspaceFiles();
	if (method === 'inspect')
		return {
			...(await container.inspect()),
			runtimeJobs: [...engines.inspect(), ...(clang?.inspect() ?? [])],
			shell: {
				running: !!shell && !shellClosed,
				closed: shellClosed,
				control: shellControl?.inspect()
			},
			ownedWorkers: children.size
		};
	if (method === 'shellStart') return await startShell(args[0] as never);
	if (method === 'shellSetDirectory') {
		await shellStarting;
		if (!shell || shellClosed || !shellControl) throw new Error('Shell is not running');
		return await shellControl.requestDirectory(language);
	}
	if (method === 'shellWrite') return await shellWrite(args[0] as string);
	if (method === 'shellEof') {
		await shellWrites;
		await shellWriter?.close();
		return;
	}
	if (method === 'shellInterrupt') {
		const interrupted = shell?.interrupt() ?? 0;
		if (!interrupted) await shellWrite('\x03');
		return;
	}
	if (method === 'shellDispose') {
		await shell?.dispose();
		shellControl?.dispose();
		shellClosed = true;
		return;
	}
	if (method === 'dispose') return await dispose();
	throw new Error('Unknown container operation');
}
scope.onmessage = (event) => {
	const request = event.data as ContainerWorkerRequest;
	if (
		!request ||
		request.version !== CONTAINER_WORKER_PROTOCOL ||
		typeof request.channel !== 'string' ||
		!Number.isSafeInteger(request.id)
	)
		return;
	if (request.type === 'init') {
		if (initialized) return;
		initialized = true;
		channel = request.channel;
		void initialize(request.settings).then(
			() => respond(0, { type: 'result', value: undefined } as never),
			(error) => {
				respond(0, { type: 'error', error: serializeContainerWorkerError(error) } as never);
				void dispose();
			}
		);
		return;
	}
	if (!initialized || request.channel !== channel) return;
	if (request.type === 'cancel') {
		requests.get(request.id)?.abort(new DOMException('Operation cancelled', 'AbortError'));
		return;
	}
	if (
		request.type !== 'call' ||
		typeof request.method !== 'string' ||
		!Array.isArray(request.args) ||
		requests.has(request.id)
	)
		return;
	const controller = new AbortController();
	requests.set(request.id, controller);
	void call(request.method, request.args, controller.signal, request.id)
		.then(
			(value) => respond(request.id, { type: 'result', value } as never),
			(error) =>
				respond(request.id, {
					type: 'error',
					error: serializeContainerWorkerError(error)
				} as never)
		)
		.finally(() => requests.delete(request.id));
};
