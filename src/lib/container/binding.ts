import type {
	PlaygroundBinding,
	BoundSandbox,
	SandboxRuntimeAssets
} from '../playground/sandbox.js';
import type { SandboxExecutionOptions } from '../playground/options.js';
import type { WorkspaceFile as ContainerWorkspaceFile } from '@wasm-idle/core';
import {
	createContainerWorkerClient,
	type ContainerWorkerClient,
	type ContainerOwnerWorker
} from './client.js';
import type {
	ContainerWorkerEvent,
	ContainerWorkspaceDelta,
	ContainerWorkspaceEntry
} from './protocol.js';

// The Bash image has no termcap database. Readline needs erase-to-end-of-line
// and an explicit newline at its right margin when the browser wraps elsewhere.
const shellEnvironment = {
	PS1: '\\[\\e[1;34m\\]\\w\\[\\e[0m\\] $ ',
	TERM: 'xterm',
	TERMCAP: String.raw`xterm:am:do=^J:ce=\E[K:cd=\E[J:cl=\E[H\E[2J:cr=^M:le=^H:nd=\E[C:up=\E[A:ku=\E[A:kd=\E[B:kr=\E[C:kl=\E[D:`,
	// Prompts use stderr. Join it to stdout before the first prompt to preserve write order.
	PROMPT_COMMAND: 'unset PROMPT_COMMAND; exec 2>&1'
};

export type ContainerPlaygroundBindingOptions = {
	applicationRootURL: string;
	workspaceId: string;
	getLanguage?: () => string;
	/** The app bundles this worker entry; no worker is created until first use. */
	workerFactory?: () => ContainerOwnerWorker;
	/** Deterministic transport contract tests only. */
	clientFactory?: () => ContainerWorkerClient;
	/** Deterministic tests only; defaults to the browser's idle and data-saving signals. */
	prewarmEnvironment?: ContainerPrewarmEnvironment;
};
export interface ContainerPrewarmEnvironment {
	canStart(): boolean;
	/** Run the callback later, never synchronously; return its cancellation. */
	schedule(callback: () => void): () => void;
}
/** Speculative runtime work honors Save-Data, slow links and hidden pages, like core's prewarmer. */
const browserPrewarmEnvironment: ContainerPrewarmEnvironment = {
	canStart() {
		if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
		const connection = (
			navigator as Navigator & {
				connection?: { saveData?: boolean; effectiveType?: string };
			}
		).connection;
		return (
			document.visibilityState !== 'hidden' &&
			connection?.saveData !== true &&
			!['slow-2g', '2g'].includes(connection?.effectiveType ?? '')
		);
	},
	schedule(callback) {
		if (typeof requestIdleCallback === 'function') {
			const id = requestIdleCallback(callback, { timeout: 1500 });
			return () => cancelIdleCallback(id);
		}
		const id = setTimeout(callback, 250);
		return () => clearTimeout(id);
	}
};
const copyFiles = (files: readonly ContainerWorkspaceFile[]) =>
	files.map((file) => ({
		path: file.path,
		content: typeof file.content === 'string' ? file.content : Uint8Array.from(file.content)
	}));
const bytes = (content: string | Uint8Array) =>
	typeof content === 'string' ? new TextEncoder().encode(content) : content;
const equal = (left: string | Uint8Array, right: string | Uint8Array) => {
	if (left === right) return true;
	const a = bytes(left),
		b = bytes(right);
	return a.length === b.length && a.every((byte, index) => byte === b[index]);
};
/** Structurally compatible with terminal UIs without depending on their components. */
export interface ContainerShellBinding {
	connect(onOutput: (text: string) => void, onError?: (error: unknown) => void): Promise<void>;
	resize(columns: number, rows: number): Promise<void>;
	write(text: string): Promise<void>;
	eof(): Promise<void>;
	interrupt(): Promise<void>;
	dispose(): Promise<void>;
}

export interface ContainerPlaygroundBinding extends PlaygroundBinding {
	readonly shell: ContainerShellBinding;
	dispose(): Promise<void>;
	inspect(): Promise<unknown>;
	setShellDirectory(language: string): Promise<void>;
	/** Claim the shared display at Bash's real primary prompt without consuming its input. */
	beginTerminalExecution(): Promise<void>;
	/** Redraw the actual Bash prompt after the Terminal has written its execution footer. */
	endTerminalExecution(): Promise<void>;
	syncWorkspace(language: string, files: readonly ContainerWorkspaceFile[]): Promise<void>;
	readWorkspace(language: string): Promise<ContainerWorkspaceFile[]>;
	/**
	 * Reconcile synchronously before the next publish. Return true from the callback to
	 * accept the remote baseline. A false result means a newer publish requires a retry.
	 */
	reconcileWorkspace(
		language: string,
		reconcile: (baseline: ContainerWorkspaceFile[], remote: ContainerWorkspaceFile[]) => boolean
	): Promise<boolean>;
	listWorkspaceFiles(): Promise<ContainerWorkspaceEntry[]>;
	publishedWorkspace(language: string): ContainerWorkspaceFile[];
	acceptWorkspace(language: string, files: readonly ContainerWorkspaceFile[]): void;
	onWorkspaceChange(listener: (event: ContainerWorkerEvent) => void): () => void;
}

/** Existing Terminal/Debug controls use this facade; every execution belongs to the owner Container. */
export function createContainerPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	options: ContainerPlaygroundBindingOptions
): ContainerPlaygroundBinding {
	if (!options.workerFactory && !options.clientFactory)
		throw new TypeError('A container owner workerFactory is required');
	let client: ContainerWorkerClient | undefined,
		disposed = false;
	const sandboxes = new Map<string, BoundSandbox>();
	const published = new Map<string, ContainerWorkspaceFile[]>();
	const changes = new Set<(event: ContainerWorkerEvent) => void>();
	const queues = new Map<string, Promise<unknown>>();
	const publishRequests = new Map<string, number>();
	const reads = new Map<
		string,
		{ revision: number; files: Map<string, ContainerWorkspaceFile> }
	>();
	let shellOutput: ((text: string) => void) | undefined;
	let shellError: ((error: unknown) => void) | undefined;
	let shellConnection: Promise<void> | undefined;
	let shellSize: { columns: number; rows: number } | undefined;
	let appliedShellSize: typeof shellSize;
	let resizingShell: Promise<void> | undefined;
	let requestedShellLanguage: string | undefined;
	let terminalExecution: 'before-shell' | 'suspended' | undefined;
	let startDeferredShell: ((start: boolean) => void) | undefined;
	const settleShellStartup = (start: boolean) => {
		startDeferredShell?.(start);
		startDeferredShell = undefined;
	};
	const prewarmEnvironment = options.prewarmEnvironment ?? browserPrewarmEnvironment;
	let prewarmEnabled = true;
	let warm:
		| {
				language: string;
				controller: AbortController;
				result: Promise<boolean>;
				released: boolean;
		  }
		| undefined;
	const abortWarm = () => {
		const current = warm;
		warm = undefined;
		current?.controller.abort(new DOMException('Runtime prewarm cancelled', 'AbortError'));
	};
	// Effects cancel and then re-request in one task; the same language keeps its progress.
	const releaseWarm = () => {
		const current = warm;
		if (!current) return;
		current.released = true;
		setTimeout(() => {
			if (warm === current && current.released) abortWarm();
		}, 0);
	};
	const decoders = new Map<string, TextDecoder>();
	const decoder = (key: string) => {
		let value = decoders.get(key);
		if (!value) decoders.set(key, (value = new TextDecoder()));
		return value;
	};
	const connection = () => {
		if (disposed) throw new Error('Container playground has been disposed');
		if (client) return client;
		client =
			options.clientFactory?.() ??
			createContainerWorkerClient({
				runtimeAssets,
				applicationRootURL: options.applicationRootURL,
				workspaceId: options.workspaceId,
				workerFactory: options.workerFactory!
			});
		client.onEvent((event) => {
			if (event.name === 'workspace') {
				for (const listener of changes) listener(event);
				return;
			}
			if (event.name === 'shell-output') {
				const data = event.data as { stream: string; bytes?: Uint8Array; error?: string };
				if (data.error) shellError?.(new Error(data.error));
				if (data.bytes)
					shellOutput?.(
						decoder(`shell:${data.stream}`).decode(data.bytes, { stream: true })
					);
				return;
			}
			const sandbox = event.language && sandboxes.get(event.language);
			if (!sandbox) return;
			if (event.name === 'output')
				sandbox.output?.(
					typeof event.data === 'string'
						? event.data
						: decoder(event.language!).decode(event.data as Uint8Array, {
								stream: true
							})
				);
			if (event.name === 'debug') sandbox.ondebug?.(event.data as never);
			if (event.name === 'diagnostic') sandbox.oncompilerdiagnostic?.(event.data as never);
			if (event.name === 'image') sandbox.image?.(event.data as never);
		});
		return client;
	};
	const cleanupOwner = async (method: string, args: unknown[] = []) => {
		if (!client || disposed) return;
		try {
			await client.call(method, args);
		} catch (error) {
			// Terminal cleanup can race the parent disposing the complete owner.
			if (!disposed) throw error;
		}
	};
	const enqueueWorkspace = <T>(language: string, operation: () => Promise<T>) => {
		const previous = queues.get(language) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(operation);
		queues.set(language, next);
		return next;
	};
	const syncWorkspace = (language: string, files: readonly ContainerWorkspaceFile[]) => {
		const snapshot = copyFiles(files);
		publishRequests.set(language, (publishRequests.get(language) ?? 0) + 1);
		return enqueueWorkspace(language, async () => {
			const baseline = published.get(language);
			if (baseline) {
				const before = new Map(baseline.map((file) => [file.path, file]));
				const changed: ContainerWorkspaceFile[] = [];
				const expected: ContainerWorkspaceFile[] = [];
				for (const file of snapshot) {
					const previous = before.get(file.path);
					before.delete(file.path);
					if (previous && equal(previous.content, file.content)) continue;
					changed.push(file);
					if (previous) expected.push(previous);
				}
				expected.push(...before.values());
				if (!changed.length && !expected.length) return;
				await connection().call('syncWorkspaceDelta', [
					language,
					changed,
					expected,
					snapshot.map((file) => ({
						path: file.path,
						bytes: bytes(file.content).byteLength
					}))
				]);
			} else await connection().call('syncWorkspace', [language, snapshot, undefined]);
			// snapshot already owns its bytes, including while queued behind another write.
			published.set(language, snapshot);
		});
	};
	const readWorkspace = async (language: string) => {
		const baseline = reads.get(language);
		const delta = await connection().call<ContainerWorkspaceDelta>('readWorkspaceDelta', [
			language,
			baseline?.revision
		]);
		if (disposed) throw new Error('Container playground has been disposed');
		const files = new Map(delta.reset ? [] : baseline?.files);
		for (const path of delta.deleted) files.delete(path);
		for (const file of delta.files) files.set(file.path, file);
		reads.set(language, { revision: delta.revision, files });
		// Match the owner's sorted directory traversal after incremental additions.
		return copyFiles(
			[...files.values()].sort((left, right) => {
				const a = left.path.split('/'),
					b = right.path.split('/');
				for (let index = 0; index < Math.min(a.length, b.length); index++) {
					if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
				}
				return a.length - b.length;
			})
		);
	};
	const shell: ContainerShellBinding = {
		connect(output, error) {
			shellOutput = output;
			shellError = error;
			return (shellConnection ??= (async () => {
				if (terminalExecution === 'before-shell') {
					// A cold Run may own the display before the Terminal connects Bash.
					const start = await new Promise<boolean>(
						(resolve) => (startDeferredShell = resolve)
					);
					if (!start) return;
				}
				const language = requestedShellLanguage ?? options.getLanguage?.() ?? 'CPP';
				await queues.get(language)?.catch(() => {});
				const initialSize = shellSize;
				await connection().call('shellStart', [
					{
						cwd: `/workspace/${language}`,
						env: shellEnvironment,
						...initialSize
					}
				]);
				appliedShellSize = initialSize;
			})());
		},
		async resize(columns, rows) {
			if (![columns, rows].every((n) => Number.isInteger(n) && n > 0 && n <= 65535))
				throw new RangeError('Shell dimensions must be integers from 1 to 65535');
			if (shellSize?.columns !== columns || shellSize.rows !== rows)
				shellSize = { columns, rows };
			if (!shellConnection || shellSize === appliedShellSize) return;
			return (resizingShell ??= (async () => {
				try {
					// connect() already reports startup failures, including unsupported shells.
					try {
						await shellConnection;
					} catch {
						return;
					}
					while (!disposed && shellSize && shellSize !== appliedShellSize) {
						const next = shellSize;
						await connection().call('shellResize', [next.columns, next.rows]);
						appliedShellSize = next;
					}
				} finally {
					// Release before promise observers can enqueue the next size.
					resizingShell = undefined;
				}
			})());
		},
		async write(text) {
			await shellConnection;
			await connection().call('shellWrite', [text]);
		},
		async eof() {
			await shellConnection;
			await connection().call('shellEof');
		},
		async interrupt() {
			await shellConnection;
			await connection().call('shellInterrupt');
		},
		async dispose() {
			settleShellStartup(false);
			await cleanupOwner('shellDispose');
		}
	};
	const binding: ContainerPlaygroundBinding = {
		async beginTerminalExecution() {
			if (terminalExecution || disposed) return;
			if (!shellConnection) {
				terminalExecution = 'before-shell';
				return;
			}
			// A shell unavailable without cross-origin isolation must not block batch Run.
			try {
				await shellConnection;
			} catch {
				return;
			}
			await connection().call('shellSuspend');
			terminalExecution = 'suspended';
		},
		async endTerminalExecution() {
			const previous = terminalExecution;
			terminalExecution = undefined;
			if (previous === 'before-shell') settleShellStartup(true);
			if (previous === 'suspended') await cleanupOwner('shellResume');
		},
		async setShellDirectory(language) {
			if (!/^[A-Z][A-Z0-9_]*$/.test(language)) throw new TypeError('Invalid shell language');
			requestedShellLanguage = language;
			// Selecting a language before Terminal mounts must not start a temporary shell.
			if (!shellConnection) return;
			await shellConnection;
			await connection().call('shellSetDirectory', [language]);
		},
		runtimeAssets,
		terminalProps: undefined as never,
		shell,
		async load(language) {
			let sandbox = sandboxes.get(language);
			if (sandbox) return sandbox;
			const invoke = <T>(
				method: string,
				args: unknown[] = [],
				execution?: SandboxExecutionOptions,
				progress?: Parameters<BoundSandbox['run']>[3]
			) =>
				connection().call<T>(method, [language, ...args], {
					signal: execution?.signal,
					progress
				});
			const record = {
				runtimeAssets,
				elapse: 0,
				async load(
					code?: string,
					log = true,
					args: string[] = [],
					execution: SandboxExecutionOptions = {},
					progress?: Parameters<BoundSandbox['run']>[3]
				) {
					await queues.get(language);
					await invoke('load', [code, log, args, execution], execution, progress);
				},
				async run(
					code: string,
					prepare: boolean,
					log = true,
					progress?: Parameters<BoundSandbox['run']>[3],
					args: string[] = [],
					execution: SandboxExecutionOptions = {}
				) {
					await queues.get(language);
					const started = performance.now();
					try {
						return await invoke<boolean | string>(
							prepare ? 'prepare' : 'run',
							[code, log, args, execution],
							execution,
							progress
						);
					} finally {
						record.elapse = Math.round(performance.now() - started);
					}
				},
				async clear() {
					await cleanupOwner('clear', [language]);
				},
				async restart() {
					await invoke('restart');
				},
				async terminate() {
					await invoke('stop');
				},
				async kill() {
					await invoke('stop');
				},
				async dispose() {
					await cleanupOwner('clear', [language]);
				},
				write(text: string) {
					void invoke('write', [text]).catch((error) => shellError?.(error));
				},
				eof() {
					void invoke('eof').catch((error) => shellError?.(error));
				}
			} as unknown as BoundSandbox;
			for (const method of [
				'debugCommand',
				'debugPause',
				'setBreakpoints',
				'setSourceBreakpoints',
				'debugEvaluate',
				'debugEvaluateValue',
				'debugSetSteppingOptions',
				'debugVariables',
				'debugScopes',
				'debugFrameScopes',
				'debugFrameName',
				'debugReadMemory',
				'debugWriteMemory',
				'debugDataBreakpointInfo',
				'debugSetDataBreakpoints'
			]) {
				(record as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
					invoke(method, args);
			}
			sandboxes.set(language, record);
			return record;
		},
		// Boot the owner, then fetch and compile the language runtime once the page is idle.
		// A Run claims that work in the owner, so cancelling here never aborts a Run.
		async prewarm(language) {
			const owner = connection();
			if (!prewarmEnabled || !prewarmEnvironment.canStart()) return false;
			if (warm?.language === language) {
				warm.released = false;
				return await warm.result;
			}
			abortWarm();
			const controller = new AbortController();
			const result = new Promise<boolean>((resolve) => {
				const cancel = prewarmEnvironment.schedule(() => {
					if (controller.signal.aborted || disposed || !prewarmEnvironment.canStart())
						return resolve(false);
					owner.call<boolean>('prewarm', [language], { signal: controller.signal }).then(
						(value) => resolve(value === true && !controller.signal.aborted),
						() => resolve(false)
					);
				});
				controller.signal.addEventListener(
					'abort',
					() => {
						cancel();
						resolve(false);
					},
					{ once: true }
				);
			});
			const current = { language, controller, result, released: false };
			warm = current;
			void result.then(() => {
				if (warm === current) warm = undefined;
			});
			return await result;
		},
		async setPrewarmEnabled(enabled) {
			if (typeof enabled !== 'boolean') throw new TypeError('prewarm must be a boolean');
			prewarmEnabled = enabled;
			if (!enabled) abortWarm();
		},
		async cancelPrewarm() {
			releaseWarm();
		},
		syncWorkspace,
		readWorkspace(language) {
			return enqueueWorkspace(language, () => readWorkspace(language));
		},
		reconcileWorkspace(language, reconcile) {
			const requested = publishRequests.get(language) ?? 0;
			return enqueueWorkspace(language, async () => {
				const baseline = copyFiles(published.get(language) ?? []);
				const remote = await readWorkspace(language);
				// A snapshot queued during this read may omit new terminal files. Let it
				// publish against its existing baseline, then reconcile a fresh snapshot.
				if ((publishRequests.get(language) ?? 0) !== requested) return false;
				if (reconcile(baseline, remote)) published.set(language, copyFiles(remote));
				return true;
			});
		},
		async listWorkspaceFiles() {
			return await connection().call<ContainerWorkspaceEntry[]>('listWorkspaceFiles');
		},
		publishedWorkspace(language) {
			return copyFiles(published.get(language) ?? []);
		},
		acceptWorkspace(language, files) {
			published.set(language, copyFiles(files));
		},
		onWorkspaceChange(listener) {
			changes.add(listener);
			return () => changes.delete(listener);
		},
		async inspect() {
			return await connection().call('inspect');
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			settleShellStartup(false);
			abortWarm();
			changes.clear();
			reads.clear();
			queues.clear();
			publishRequests.clear();
			await client?.dispose();
		}
	};
	binding.terminalProps = { playground: binding, runtimeAssets };
	return binding;
}
