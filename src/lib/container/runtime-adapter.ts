import {
	assertDebugBreakpointSupport,
	normalizeDebugSourceBreakpoints,
	normalizeLanguageId,
	normalizeWorkspacePath,
	validateWorkspaceFiles,
	type DebugSourceBreakpoint,
	type ProgressLike,
	type WorkspaceFile
} from '@wasm-idle/core';
import {
	ContainerError,
	type Container,
	type ContainerProcess,
	type FileVersion,
	type LiveCommandAdapter,
	type MemoryFileSystem
} from '@wasm-idle/container';
import type {
	BoundSandbox,
	PlaygroundBinding,
	SandboxRuntimeAssets
} from '../playground/sandbox.js';
import type { SandboxExecutionOptions } from '../playground/options.js';
import type {
	ContainerWorkerEvent,
	ContainerWorkspaceDelta,
	ContainerWorkspaceEntry,
	ContainerWorkspaceFileMetadata
} from './protocol.js';

const COMMAND = 'website-playground-engine';
const ADAPTER = 'website-playground-host-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const defaultSource = (language: string) =>
	({
		C: 'main.c',
		CPP: 'main.cpp',
		PYTHON: 'main.py',
		PYTHON3: 'main.py',
		JAVA: 'Main.java',
		RUST: 'main.rs',
		GO: 'main.go',
		JAVASCRIPT: 'main.js',
		TYPESCRIPT: 'main.ts'
	})[language] ?? 'main.txt';
type EngineSandbox = BoundSandbox & Record<string, unknown>;
interface Session {
	binding: PlaygroundBinding;
	sandbox: Promise<EngineSandbox>;
	active?: Job;
	pendingInput: string[];
	pendingBytes: number;
	pendingEof: boolean;
}
interface Job {
	id: string;
	language: string;
	method: 'load' | 'prepare' | 'run';
	requestId: number;
	code: string;
	log: boolean;
	args: string[];
	options: SandboxExecutionOptions;
	signal: AbortSignal;
	controller: AbortController;
	finished: Promise<void>;
	progress?: ProgressLike;
	result?: boolean | string;
	error?: unknown;
	process?: ContainerProcess;
	writer?: WritableStreamDefaultWriter<Uint8Array>;
	output?: (data: string) => void;
	readyForInput?: boolean;
}
export type ContainerRuntimeBindingFactory = (
	runtimeAssets: SandboxRuntimeAssets
) => PlaygroundBinding;

export interface ContainerRuntimeAdapterOptions {
	runtimeAssets: SandboxRuntimeAssets;
	emit(event: ContainerWorkerEvent): void;
	/** The application chooses its real language registry; the host imports no engines. */
	createBinding: ContainerRuntimeBindingFactory;
}

/** Existing real engines keep their private runtime FS; their source snapshot is the common VFS. */
export class ContainerRuntimeAdapter {
	readonly adapter: LiveCommandAdapter;
	readonly commands = {
		[COMMAND]: { adapter: ADAPTER, bytes: new Uint8Array(), argv0: COMMAND }
	};
	readonly filesystemProfile = 'shared-source-snapshot; runtime-private-files-not-exported';
	#container?: Container;
	#sessions = new Map<string, Session>();
	#jobs = new Map<string, Job>();
	#published = new Map<string, Set<string>>();
	#workspaceReads = new Map<string, { revision: number; versions: Map<string, FileVersion> }>();
	#nextJob = 0;
	#disposed = false;

	constructor(private readonly settings: ContainerRuntimeAdapterOptions) {
		this.adapter = {
			id: ADAPTER,
			filesystem: 'live',
			start: async (request) => {
				const job = this.#jobs.get(request.invocation.args[0]);
				if (
					!job ||
					request.invocation.args.length !== 1 ||
					request.fs !== this.fs ||
					request.invocation.cwd !== this.directory(job.language)
				)
					throw new ContainerError('INVALID_ARGUMENT', 'Unknown application runtime job');
				let output!: ReadableStreamDefaultController<Uint8Array>,
					errors!: ReadableStreamDefaultController<Uint8Array>;
				let closed = false,
					bytes = 0;
				const stdout = new ReadableStream<Uint8Array>({
					start(controller) {
						output = controller;
					}
				});
				const stderr = new ReadableStream<Uint8Array>({
					start(controller) {
						errors = controller;
					}
				});
				const session = this.session(job.language);
				job.output = (data) => {
					if (closed || request.signal.aborted) return;
					const chunk = encoder.encode(data);
					bytes += chunk.byteLength;
					if (bytes > request.limits.maxOutputBytes) {
						job.error = new ContainerError(
							'RESOURCE_LIMIT',
							'Runtime output exceeds the container limit'
						);
						job.controller.abort(job.error);
						return;
					}
					if (chunk.byteLength) output.enqueue(chunk);
				};
				const abort = () => {
					void session.sandbox.then((sandbox) => sandbox.terminate()).catch(() => {});
				};
				request.signal.addEventListener('abort', abort, { once: true });
				return {
					stdin: new WritableStream<Uint8Array>({
						write: (chunk) =>
							this.write(job.language, decoder.decode(chunk, { stream: true })),
						close: () => (job.method === 'run' ? this.eof(job.language) : undefined)
					}),
					stdout,
					stderr,
					run: async () => {
						try {
							const sandbox = await session.sandbox;
							request.signal.throwIfAborted();
							const options = { ...job.options, signal: request.signal };
							if (job.method === 'load') {
								await sandbox.load(
									job.code,
									job.log,
									job.args,
									options,
									job.progress
								);
								job.result = true;
							} else {
								const running = sandbox.run(
									job.code,
									job.method === 'prepare',
									job.log,
									job.progress,
									job.args,
									options
								);
								if (job.method === 'run') {
									job.readyForInput = true;
									await this.flushInput(session, sandbox);
								}
								job.result = await running;
							}
							if (job.error) throw job.error;
							return { code: job.result === false ? 1 : 0 };
						} catch (error) {
							job.error = error;
							throw error;
						}
					},
					dispose: async () => {
						if (closed) return;
						closed = true;
						request.signal.removeEventListener('abort', abort);
						job.readyForInput = false;
						if (request.signal.aborted)
							await session.sandbox
								.then((sandbox) => sandbox.terminate())
								.catch(() => {});
						output.close();
						errors.close();
					}
				};
			}
		};
	}
	attach(container: Container) {
		if (this.#container) throw new Error('Runtime adapter is already attached');
		this.#container = container;
	}
	get fs(): MemoryFileSystem {
		if (!this.#container) throw new Error('Container not attached');
		return this.#container.fs;
	}
	private directoryPath(language: string) {
		if (
			typeof language !== 'string' ||
			!/^[A-Z][A-Z0-9_]{0,63}$/u.test(language) ||
			!normalizeLanguageId(language)
		)
			throw new TypeError('Unsupported workspace language');
		return `/workspace/${language}`;
	}
	directory(language: string) {
		const path = this.directoryPath(language);
		this.fs.mkdir(path, { recursive: true });
		return path;
	}
	private session(language: string): Session {
		if (this.#disposed) throw new Error('Runtime owner disposed');
		let session = this.#sessions.get(language);
		if (session) return session;
		const binding = this.settings.createBinding(this.settings.runtimeAssets);
		session = {
			binding,
			sandbox: undefined as unknown as Promise<EngineSandbox>,
			pendingInput: [],
			pendingBytes: 0,
			pendingEof: false
		};
		const owner = session;
		session.sandbox = binding.load(language).then((value) => {
			const sandbox = value as EngineSandbox;
			sandbox.output = (data) => owner.active?.output?.(data);
			for (const [property, name] of [
				['ondebug', 'debug'],
				['oncompilerdiagnostic', 'diagnostic'],
				['image', 'image']
			] as const)
				sandbox[property] = (data: unknown) =>
					this.settings.emit({
						language,
						name,
						data,
						requestId: owner.active?.requestId
					});
			return sandbox;
		});
		void session.sandbox.catch(() => {});
		this.#sessions.set(language, session);
		return session;
	}
	syncWorkspace(
		language: string,
		files: readonly WorkspaceFile[],
		expectedBaseFiles?: readonly WorkspaceFile[],
		project?: readonly ContainerWorkspaceFileMetadata[]
	) {
		const path = this.directoryPath(language);
		const validated = validateWorkspaceFiles(files, {
			maxFiles: 2048,
			maxFileBytes: 16 * 1024 * 1024,
			maxTotalBytes: 64 * 1024 * 1024,
			caseSensitive: true
		});
		const next = new Set(validated.map((file) => file.path));
		let publishedNext = next;
		if (project !== undefined) {
			if (expectedBaseFiles === undefined || !Array.isArray(project) || project.length > 2048)
				throw new TypeError('Invalid workspace delta metadata');
			// Keep whole-project path/count/size admission without sending unchanged bodies.
			const paths = validateWorkspaceFiles(
				project.map((file) => ({ path: file.path, content: '' })),
				{ maxFiles: 2048, caseSensitive: true }
			);
			const sizes = new Map<string, number>();
			let total = 0;
			for (let index = 0; index < paths.length; index++) {
				const size = project[index].bytes;
				if (!Number.isSafeInteger(size) || size < 0 || size > 16 * 1024 * 1024)
					throw new TypeError('Invalid workspace file size');
				total += size;
				sizes.set(paths[index].path, size);
			}
			if (total > 64 * 1024 * 1024) throw new TypeError('Workspace exceeds total size limit');
			for (const file of validated) {
				const size =
					typeof file.content === 'string'
						? encoder.encode(file.content).length
						: file.content.length;
				if (sizes.get(file.path) !== size)
					throw new TypeError('Workspace delta size mismatch');
			}
			publishedNext = new Set(sizes.keys());
		}
		const asBytes = (content: WorkspaceFile['content']) =>
			typeof content === 'string' ? encoder.encode(content) : content;
		const equal = (left: Uint8Array | undefined, right: Uint8Array | undefined) =>
			left === undefined || right === undefined
				? left === right
				: left.length === right.length &&
					left.every((byte, index) => byte === right[index]);
		const current = (name: string) => {
			try {
				return this.fs.readFile(name, { root: path, cwd: path });
			} catch (error) {
				if ((error as { code?: string }).code !== 'ENOENT') throw error;
				return undefined;
			}
		};
		const base =
			expectedBaseFiles === undefined
				? undefined
				: new Map(
						validateWorkspaceFiles(expectedBaseFiles, {
							maxFiles: 2048,
							maxFileBytes: 16 * 1024 * 1024,
							maxTotalBytes: 64 * 1024 * 1024,
							caseSensitive: true
						}).map((file) => [file.path, asBytes(file.content)])
					);
		const previousPaths = base?.keys() ?? this.#published.get(language) ?? [];
		const deletions = [...previousPaths].filter((previous) => !next.has(previous));
		if (project && deletions.some((name) => publishedNext.has(name)))
			throw new TypeError('Deleted workspace file remains in project metadata');
		// Compare all touched files before publishing even the first edit. Shell-created
		// paths outside the editor's baseline are retained unless explicitly supplied.
		if (base) {
			for (const file of validated) {
				const before = base.get(file.path),
					after = asBytes(file.content);
				if (equal(before, after)) continue;
				const present = current(file.path);
				if (!equal(present, before) && !equal(present, after))
					throw new ContainerError(
						'FILESYSTEM_CONFLICT',
						`Workspace changed while editing ${file.path}`
					);
			}
			for (const file of deletions)
				if (current(file) !== undefined && !equal(current(file), base.get(file)))
					throw new ContainerError(
						'FILESYSTEM_CONFLICT',
						`Workspace changed before deleting ${file}`
					);
		}
		this.fs.applyFileChanges(
			{
				remove: deletions,
				write: validated
					// Unchanged editor buffers must not overwrite newer shell revisions.
					.filter(
						(file) =>
							!base?.has(file.path) ||
							!equal(base.get(file.path), asBytes(file.content))
					)
					.map((file) => ({ path: file.path, bytes: asBytes(file.content) }))
			},
			{ root: path, cwd: path, createRoot: true }
		);
		this.#published.set(language, publishedNext);
	}
	readWorkspaceDelta(language: string, since?: number): ContainerWorkspaceDelta {
		const root = this.directory(language);
		const previous = this.#workspaceReads.get(language);
		const reset = !previous || since !== previous.revision;
		const versions = new Map<string, FileVersion>();
		const files: WorkspaceFile[] = [];
		const visit = (path: string) => {
			for (const name of this.fs.readdir(path || '.', { root, cwd: root })) {
				const relative = path ? `${path}/${name}` : name;
				const options = { root, cwd: root };
				const stat = this.fs.lstat(relative, options);
				if (stat.type === 'directory') visit(relative);
				else if (stat.type === 'file') {
					const version = this.fs.captureFileVersion(relative, options);
					versions.set(relative, version);
					if (reset || previous?.versions.get(relative) !== version)
						files.push({
							path: relative,
							content: this.fs.readFile(relative, options)
						});
				}
			}
		};
		visit('');
		const deleted = reset
			? []
			: [...previous!.versions.keys()].filter((path) => !versions.has(path));
		const revision = (previous?.revision ?? 0) + 1;
		this.#workspaceReads.set(language, { revision, versions });
		return { revision, reset, files, deleted };
	}
	readWorkspace(language: string): WorkspaceFile[] {
		const root = this.directory(language),
			files: WorkspaceFile[] = [];
		const visit = (path: string) => {
			for (const name of this.fs.readdir(path || '.', { root, cwd: root })) {
				const relative = path ? `${path}/${name}` : name;
				const stat = this.fs.lstat(relative, { root, cwd: root });
				if (stat.type === 'directory') visit(relative);
				else if (stat.type === 'file')
					files.push({
						path: relative,
						content: this.fs.readFile(relative, { root, cwd: root })
					});
			}
		};
		visit('');
		return files;
	}
	/** Enumerate the common namespace without copying file bodies or following links. */
	listWorkspaceFiles(): ContainerWorkspaceEntry[] {
		const entries: ContainerWorkspaceEntry[] = [];
		const options = { root: '/workspace', cwd: '/workspace' };
		const visit = (parent: string) => {
			for (const name of this.fs.readdir(parent || '.', options)) {
				const path = parent ? `${parent}/${name}` : name;
				const stat = this.fs.lstat(path, options);
				if (stat.type !== 'file' && stat.type !== 'directory' && stat.type !== 'symlink')
					continue;
				entries.push({ path, type: stat.type, size: stat.size });
				if (stat.type === 'directory') visit(path);
			}
		};
		visit('');
		return entries;
	}
	inputs(language: string, code: string, options: SandboxExecutionOptions) {
		const root = this.directory(language);
		const activePath = normalizeWorkspacePath(options.activePath ?? defaultSource(language));
		try {
			this.fs.stat(activePath, { root, cwd: root });
		} catch (error) {
			if ((error as { code?: string }).code !== 'ENOENT') throw error;
			this.syncWorkspace(language, [
				...new Map(
					[...(options.workspaceFiles ?? []), { path: activePath, content: code }].map(
						(entry) => [entry.path, entry]
					)
				).values()
			]);
		}
		const files = this.readWorkspace(language);
		return {
			code: new TextDecoder('utf-8', { fatal: true }).decode(
				this.fs.readFile(activePath, { root, cwd: root })
			),
			options: {
				...options,
				activePath,
				workspaceFiles: files
			} as unknown as SandboxExecutionOptions
		};
	}
	async execute(
		method: Job['method'],
		language: string,
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		signal: AbortSignal,
		progress?: ProgressLike,
		requestId = 0
	) {
		signal.throwIfAborted();
		const session = this.session(language);
		if (session.active)
			throw new ContainerError(
				'RESOURCE_LIMIT',
				`${language} already has an active runtime job`
			);
		const source = this.inputs(language, code, options);
		const controller = new AbortController();
		signal = AbortSignal.any([signal, controller.signal]);
		let finish!: () => void;
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const job: Job = {
			id: String(++this.#nextJob),
			language,
			method,
			code: source.code,
			log,
			args: [...args],
			options: source.options,
			signal,
			controller,
			finished,
			progress,
			requestId
		};
		session.active = job;
		this.#jobs.set(job.id, job);
		try {
			const process = await this.#container!.spawn(COMMAND, [job.id], {
				cwd: this.directory(language),
				env: options.env,
				signal
			});
			job.process = process;
			if (signal.aborted) {
				await process.terminate();
				signal.throwIfAborted();
			}
			const drain = async (stream: ReadableStream<Uint8Array>) => {
				const reader = stream.getReader(),
					text = new TextDecoder();
				try {
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						const data = text.decode(value, { stream: true });
						if (data) this.settings.emit({ language, name: 'output', data, requestId });
					}
					const tail = text.decode();
					if (tail)
						this.settings.emit({ language, name: 'output', data: tail, requestId });
				} finally {
					reader.releaseLock();
				}
			};
			const [result] = await Promise.all([
				process.exited,
				drain(process.stdout),
				drain(process.stderr)
			]);
			if (signal.aborted)
				throw signal.reason ?? new DOMException('Runtime cancelled', 'AbortError');
			if (job.error) throw job.error;
			if (result.reason !== 'exited') throw new Error(`Runtime ended with ${result.reason}`);
			return method === 'load' ? undefined : (job.result ?? result.code === 0);
		} catch (error) {
			signal.throwIfAborted();
			throw error;
		} finally {
			if (session.active === job) session.active = undefined;
			this.#jobs.delete(job.id);
			finish();
		}
	}
	private async flushInput(session: Session, sandbox: EngineSandbox) {
		if (!session.active?.readyForInput) return;
		for (const value of session.pendingInput.splice(0)) sandbox.write?.(value);
		session.pendingBytes = 0;
		if (session.pendingEof) {
			session.pendingEof = false;
			sandbox.eof();
		}
	}
	async write(language: string, value: string) {
		if (typeof value !== 'string') throw new TypeError('Runtime input must be text');
		const session = this.session(language);
		if (session.pendingEof) throw new Error('Runtime input is closed');
		const size = encoder.encode(value).byteLength;
		if (session.pendingBytes + size > 8 * 1024 * 1024)
			throw new Error('Pending runtime input exceeds the container limit');
		session.pendingInput.push(value);
		session.pendingBytes += size;
		if (session.active?.readyForInput) await this.flushInput(session, await session.sandbox);
	}
	async eof(language: string) {
		const session = this.session(language);
		session.pendingEof = true;
		if (session.active?.readyForInput) await this.flushInput(session, await session.sandbox);
	}
	async stop(language: string) {
		const session = this.#sessions.get(language);
		if (!session) return;
		session.pendingInput.length = 0;
		session.pendingBytes = 0;
		session.pendingEof = false;
		const job = session.active;
		if (job) {
			job.controller.abort(new DOMException('Runtime cancelled', 'AbortError'));
			// Admission may not have returned a process handle yet. Its signal owns
			// cleanup, and Stop completes only after this exact job releases ownership.
			await job.finished;
			return;
		}
		await session.sandbox
			.then((sandbox) => {
				if (this.#sessions.get(language) === session && !session.active)
					return sandbox.terminate();
			})
			.catch(() => {});
	}
	async clear(language: string) {
		await (await this.session(language).sandbox).clear();
	}
	async restart(language: string) {
		await this.stop(language);
		const session = this.#sessions.get(language);
		this.#sessions.delete(language);
		await session?.binding.dispose?.();
	}
	async debug(language: string, method: string, args: unknown[]) {
		const allowed = new Set([
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
		]);
		if (!allowed.has(method)) throw new TypeError('Unknown debugger method');
		const specifications =
			method === 'setSourceBreakpoints'
				? normalizeDebugSourceBreakpoints(args[0] as DebugSourceBreakpoint[])
				: undefined;
		const sourcePath = specifications ? args[1] : undefined;
		if (sourcePath !== undefined && typeof sourcePath !== 'string')
			throw new TypeError('Invalid debugger source path');
		const sandbox = await this.session(language).sandbox;
		const handler = sandbox[method];
		if (
			specifications &&
			typeof handler !== 'function' &&
			typeof sandbox.setBreakpoints === 'function'
		) {
			assertDebugBreakpointSupport(specifications, {});
			return await sandbox.setBreakpoints(
				specifications
					.filter((value) => value.enabled !== false)
					.map((value) => value.line),
				sourcePath
			);
		}
		if (typeof handler !== 'function')
			throw new Error(`The ${language} runtime does not support ${method}`);
		return await handler.apply(sandbox, specifications ? [specifications, sourcePath] : args);
	}
	inspect() {
		return [...this.#jobs.values()].map((job) => ({
			language: job.language,
			pid: job.process?.pid,
			phase: job.method,
			filesystem: this.filesystemProfile
		}));
	}
	async dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		await Promise.allSettled(
			[...this.#sessions].map(async ([language, session]) => {
				const stopping = session.active ? this.stop(language) : Promise.resolve();
				// Disposing the binding can release a sandbox load that job cleanup awaits.
				await Promise.all([stopping, session.binding.dispose?.()]);
			})
		);
		this.#sessions.clear();
		this.#jobs.clear();
		this.#workspaceReads.clear();
	}
}

export { ContainerRuntimeAdapter as WebsiteRuntimeAdapter };
