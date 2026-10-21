import type { PlaygroundBinding, BoundSandbox, SandboxRuntimeAssets } from '../sandbox';
import type { SandboxExecutionOptions } from '../options';
import type { TerminalShellBinding } from '@wasm-idle/terminal';
import type { WorkspaceFile as ContainerWorkspaceFile } from '@wasm-idle/core';
import { createContainerWorkerClient, type ContainerWorkerClient } from './client';
import type { ContainerWorkerEvent, ContainerWorkspaceEntry } from './protocol';

type BindingOptions = {
	applicationRootURL: string;
	workspaceId: string;
	getLanguage?: () => string;
	/** Deterministic transport contract tests only. */
	clientFactory?: () => ContainerWorkerClient;
};
const copyFiles = (files: readonly ContainerWorkspaceFile[]) =>
	files.map((file) => ({
		path: file.path,
		content: typeof file.content === 'string' ? file.content : Uint8Array.from(file.content)
	}));
const bytes = (content: string | Uint8Array) =>
	typeof content === 'string' ? new TextEncoder().encode(content) : content;
const equal = (left: string | Uint8Array, right: string | Uint8Array) => {
	const a = bytes(left),
		b = bytes(right);
	return a.length === b.length && a.every((byte, index) => byte === b[index]);
};
function sameFiles(
	left: readonly ContainerWorkspaceFile[],
	right: readonly ContainerWorkspaceFile[]
) {
	return (
		left.length === right.length &&
		left.every((file) => {
			const other = right.find((candidate) => candidate.path === file.path);
			return other && equal(file.content, other.content);
		})
	);
}

export interface ContainerPlaygroundBinding extends PlaygroundBinding {
	readonly shell: TerminalShellBinding;
	inspect(): Promise<unknown>;
	setShellDirectory(language: string): Promise<void>;
	syncWorkspace(language: string, files: readonly ContainerWorkspaceFile[]): Promise<void>;
	readWorkspace(language: string): Promise<ContainerWorkspaceFile[]>;
	listWorkspaceFiles(): Promise<ContainerWorkspaceEntry[]>;
	publishedWorkspace(language: string): ContainerWorkspaceFile[];
	acceptWorkspace(language: string, files: readonly ContainerWorkspaceFile[]): void;
	onWorkspaceChange(listener: (event: ContainerWorkerEvent) => void): () => void;
}

/** Existing Terminal/Debug controls use this facade; every execution belongs to the owner Container. */
export function createContainerPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	options: BindingOptions
): ContainerPlaygroundBinding {
	let client: ContainerWorkerClient | undefined,
		disposed = false;
	const sandboxes = new Map<string, BoundSandbox>();
	const published = new Map<string, ContainerWorkspaceFile[]>();
	const changes = new Set<(event: ContainerWorkerEvent) => void>();
	const queues = new Map<string, Promise<void>>();
	let shellOutput: ((text: string) => void) | undefined;
	let shellError: ((error: unknown) => void) | undefined;
	let shellConnection: Promise<void> | undefined;
	let requestedShellLanguage: string | undefined;
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
				workspaceId: options.workspaceId
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
	const syncWorkspace = (language: string, files: readonly ContainerWorkspaceFile[]) => {
		const snapshot = copyFiles(files);
		const previous = queues.get(language) ?? Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(async () => {
				const baseline = published.get(language);
				if (baseline && sameFiles(baseline, snapshot)) return;
				await connection().call('syncWorkspace', [
					language,
					snapshot,
					baseline && copyFiles(baseline)
				]);
				published.set(language, copyFiles(snapshot));
			});
		queues.set(language, next);
		return next;
	};
	const shell: TerminalShellBinding = {
		connect(output, error) {
			shellOutput = output;
			shellError = error;
			return (shellConnection ??= (async () => {
				const language = requestedShellLanguage ?? options.getLanguage?.() ?? 'CPP';
				await queues.get(language)?.catch(() => {});
				await connection().call('shellStart', [
					{
						cwd: `/workspace/${language}`,
						env: { PS1: '\\[\\e[1;34m\\]\\w\\[\\e[0m\\] $ ' }
					}
				]);
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
			if (client && !disposed) await client.call('shellDispose');
		}
	};
	const binding: ContainerPlaygroundBinding = {
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
					await invoke('clear');
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
					if (client && !disposed) await invoke('clear');
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
				'debugEvaluate',
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
		// Owner and command index can be ready without fetching compiler bodies at page boot.
		async prewarm() {
			connection();
			return true;
		},
		async setPrewarmEnabled() {},
		async cancelPrewarm() {},
		syncWorkspace,
		async readWorkspace(language) {
			await queues.get(language)?.catch(() => {});
			return await connection().call<ContainerWorkspaceFile[]>('readWorkspace', [language]);
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
			changes.clear();
			await client?.dispose();
		}
	};
	binding.terminalProps = { playground: binding, runtimeAssets };
	return binding;
}
