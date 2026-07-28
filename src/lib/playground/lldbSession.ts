import type {
	DebugCommand,
	DebugFrame,
	DebugPauseReason,
	DebugScope,
	DebugSessionEvent,
	DebugVariable
} from '$lib/playground/options';
import {
	createBrowserLldbSession,
	parseDebugRuntimeManifest,
	type BrowserLldbSession,
	type DapEvent,
	type RuntimeManifestV2
} from '@wasm-idle/llvm-core/debug';

export interface LldbArtifactPayload {
	bytes: Uint8Array | ArrayBuffer;
	descriptor?: {
		moduleSha256?: string;
		compiler?: {
			name?: string;
			version?: string;
			revision?: string;
			llvmVersion?: string;
			llvmRevision?: string;
		};
	};
	sources: Array<{
		path: `/workspace/${string}`;
		content: string;
		contentSha256?: string;
	}>;
}

export interface LldbSandboxSessionOptions {
	manifestUrl: string;
	runtimeBaseUrl: string;
	artifact: LldbArtifactPayload;
	sourcePath: `/workspace/${string}`;
	breakpoints: number[];
	sourceBreakpoints?: Array<{
		sourcePath: `/workspace/${string}`;
		lines: number[];
	}>;
	pauseOnEntry: boolean;
	programArgs?: string[];
	stdin?: string;
	onDebugEvent: (event: DebugSessionEvent) => void;
	onOutput: (output: string) => void;
	fetchImpl?: typeof fetch;
}

interface DapThread {
	id: number;
	name: string;
}

interface DapStackFrame {
	id: number;
	name: string;
	source?: { path?: string };
	line: number;
	column: number;
}

interface DapScope {
	name: string;
	variablesReference: number;
	expensive: boolean;
}

interface DapVariable {
	name: string;
	value: string;
	type?: string;
	variablesReference?: number;
	memoryReference?: string;
}

function pauseReason(reason: string, command: DebugCommand | null): DebugPauseReason {
	if (reason === 'breakpoint') return 'breakpoint';
	if (reason === 'entry') return 'entry';
	if (reason === 'pause') return 'pause';
	if (command === 'nextLine') return 'nextLine';
	if (command === 'stepOut') return 'stepOut';
	return 'step';
}

async function loadManifest(url: string, fetchImpl: typeof fetch): Promise<RuntimeManifestV2> {
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(`Unable to load the LLDB runtime manifest (${response.status}).`);
	}
	return parseDebugRuntimeManifest(await response.json());
}

export class LldbSandboxSession {
	private session?: BrowserLldbSession;
	private activeThreadId = 1;
	private activeFrameId?: number;
	private command: DebugCommand | null = null;
	private stopped = false;
	private stateVersion = 0;
	private completionResolve?: (value: true) => void;
	private completionReject?: (error: Error) => void;
	private readonly pendingInput: string[] = [];
	private pendingEof = false;
	private inputReady = false;
	private lifecycleVersion = 0;
	private initialized = false;
	private supportsEvaluateExpressions = false;
	private breakpointVersion = 0;
	private dapExitCode: number | null = null;
	private readonly breakpointsBySource = new Map<`/workspace/${string}`, number[]>();
	private readonly sourceContentSha256ByPath = new Map<string, string>();

	constructor(private readonly options: LldbSandboxSessionOptions) {
		const sourceBreakpoints = options.sourceBreakpoints?.length
			? options.sourceBreakpoints
			: [{ sourcePath: options.sourcePath, lines: options.breakpoints }];
		for (const { sourcePath, lines } of sourceBreakpoints) {
			this.breakpointsBySource.set(sourcePath, [...lines]);
		}
		for (const source of options.artifact.sources) {
			if (source.contentSha256) {
				this.sourceContentSha256ByPath.set(source.path, source.contentSha256);
			}
		}
	}

	async start(): Promise<true> {
		if (this.session) throw new Error('LLDB sandbox session is already running.');
		const lifecycleVersion = ++this.lifecycleVersion;
		this.stopped = false;
		this.initialized = false;
		this.dapExitCode = null;
		const completion = new Promise<true>((resolve, reject) => {
			this.completionResolve = resolve;
			this.completionReject = reject;
		});
		void completion.catch(() => undefined);
		const manifest = await loadManifest(
			this.options.manifestUrl,
			this.options.fetchImpl ?? fetch
		);
		this.supportsEvaluateExpressions =
			manifest.debugger?.capabilities?.evaluateExpressions === true;
		if (lifecycleVersion !== this.lifecycleVersion) return completion;
		const artifactCompiler = this.options.artifact.descriptor?.compiler;
		if (
			artifactCompiler?.name === 'clang' &&
			artifactCompiler.revision &&
			artifactCompiler.revision !== manifest.debugger.lldb.llvmRevision
		) {
			throw new Error(
				`Compiler/LLDB revision mismatch: artifact ${artifactCompiler.revision}, runtime ${manifest.debugger.lldb.llvmRevision}.`
			);
		}
		if (
			artifactCompiler?.name === 'rustc' &&
			artifactCompiler.llvmVersion &&
			artifactCompiler.llvmVersion !== manifest.debugger.lldb.llvmVersion
		) {
			throw new Error(
				`Rust LLVM/LLDB version mismatch: artifact ${artifactCompiler.llvmVersion}, runtime ${manifest.debugger.lldb.llvmVersion}.`
			);
		}
		let session!: BrowserLldbSession;
		const sourceBreakpoints = Array.from(this.breakpointsBySource, ([sourcePath, lines]) => ({
			sourcePath,
			lines: [...lines]
		}));
		const configuredBreakpointVersion = this.breakpointVersion;
		session = createBrowserLldbSession({
			manifest,
			runtimeBaseUrl: this.options.runtimeBaseUrl,
			module: this.options.artifact.bytes,
			moduleSha256: this.options.artifact.descriptor?.moduleSha256,
			sources: this.options.artifact.sources,
			breakpoints: sourceBreakpoints.map(({ sourcePath, lines }) => ({
				source: { path: sourcePath },
				lines
			})),
			launch: {
				program: '/workspace/program.wasm',
				stopOnEntry: this.options.pauseOnEntry,
				args: this.options.programArgs
			},
			fetchImpl: this.options.fetchImpl,
			onOutput: (_channel, output) => this.options.onOutput(output),
			onLifecycle: (event) => {
				if (lifecycleVersion !== this.lifecycleVersion || this.session !== session) {
					return;
				}
				if (event.type === 'worker-error') {
					this.fail(new Error(`${event.worker} debug worker failed: ${event.message}`));
				} else {
					this.finish(event.exitCode ?? this.dapExitCode);
				}
			}
		});
		if (lifecycleVersion !== this.lifecycleVersion) {
			await session.dispose();
			return completion;
		}
		this.session = session;
		session.onEvent((event) => {
			if (lifecycleVersion === this.lifecycleVersion && this.session === session) {
				this.handleDapEvent(event);
			}
		});
		try {
			await session.initialize();
			if (lifecycleVersion !== this.lifecycleVersion || this.session !== session) {
				await session.dispose();
				return completion;
			}
			this.initialized = true;
			if (configuredBreakpointVersion === this.breakpointVersion) {
				for (const { sourcePath, lines } of sourceBreakpoints) {
					this.publishResolvedBreakpoints(
						session.getResolvedBreakpoints(sourcePath),
						lines,
						sourcePath
					);
				}
			} else {
				for (const [sourcePath, lines] of this.breakpointsBySource) {
					await this.setBreakpoints(lines, sourcePath);
				}
			}
			this.inputReady = true;
			if (this.options.stdin !== undefined) {
				this.pendingInput.push(this.options.stdin);
				this.pendingEof = true;
			}
			await this.flushInput();
		} catch (error) {
			if (
				lifecycleVersion === this.lifecycleVersion &&
				this.stopped &&
				this.session !== session
			) {
				return completion;
			}
			await session.dispose();
			if (this.session === session) this.session = undefined;
			if (lifecycleVersion !== this.lifecycleVersion) return completion;
			throw error;
		}
		return completion;
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		return this.flushInput();
	}

	eof() {
		this.pendingEof = true;
		return this.flushInput();
	}

	async debugCommand(command: DebugCommand) {
		const session = this.requireSession();
		this.command = command;
		const dapCommand =
			command === 'stepInto'
				? 'stepIn'
				: command === 'nextLine'
					? 'next'
					: command === 'stepOut'
						? 'stepOut'
						: 'continue';
		await session.request(dapCommand, { threadId: this.activeThreadId });
		this.options.onDebugEvent({ type: 'resume', command });
	}

	async pause() {
		await this.requireSession().request('pause', {
			threadId: this.activeThreadId
		});
	}

	async setBreakpoints(lines: number[], sourcePath = this.options.sourcePath) {
		this.breakpointsBySource.set(sourcePath, [...lines]);
		this.breakpointVersion += 1;
		if (!this.session || !this.initialized) return;
		const response = await this.requireSession().request<{
			breakpoints?: Array<{
				verified?: boolean;
				line?: number;
				message?: string;
			}>;
		}>('setBreakpoints', {
			source: { path: sourcePath },
			breakpoints: lines.map((line) => ({ line })),
			lines,
			sourceModified: false
		});
		this.publishResolvedBreakpoints(response.breakpoints ?? [], lines, sourcePath);
	}

	async evaluate(expression: string) {
		if (!this.supportsEvaluateExpressions || !this.activeFrameId) return '?';
		try {
			const result = await this.requireSession().request<{ result?: string }>('evaluate', {
				expression,
				frameId: this.activeFrameId,
				context: 'watch'
			});
			return result.result ?? '?';
		} catch {
			return '?';
		}
	}

	async variables(variablesReference: number, start?: number, count?: number) {
		const response = await this.requireSession().request<{ variables?: DapVariable[] }>(
			'variables',
			{
				variablesReference,
				...(start === undefined ? {} : { start }),
				...(count === undefined ? {} : { count })
			}
		);
		return (response.variables ?? []).map<DebugVariable>((variable) => ({
			name: variable.name,
			value: variable.value,
			type: variable.type,
			variablesReference: variable.variablesReference ?? 0,
			memoryReference: variable.memoryReference
		}));
	}

	async disconnect() {
		this.lifecycleVersion += 1;
		this.stateVersion += 1;
		this.inputReady = false;
		this.initialized = false;
		this.supportsEvaluateExpressions = false;
		this.dapExitCode = null;
		const session = this.session;
		this.session = undefined;
		const shouldPublishStop = !this.stopped;
		this.stopped = true;
		await session?.disconnect({ terminateTarget: true });
		if (shouldPublishStop) this.options.onDebugEvent({ type: 'stop' });
		this.completionResolve?.(true);
	}

	private handleDapEvent(event: DapEvent) {
		if (event.event === 'output') {
			const body = event.body as { output?: unknown } | undefined;
			if (typeof body?.output === 'string') this.options.onOutput(body.output);
			return;
		}
		if (event.event === 'stopped') {
			const body = event.body as
				| { reason?: string; threadId?: number; allThreadsStopped?: boolean }
				| undefined;
			const version = ++this.stateVersion;
			void this.resolveStoppedState(body?.threadId, body?.reason || 'pause', version).catch(
				(error) =>
					this.fail(
						error instanceof Error
							? error
							: new Error('Unable to read LLDB stopped state.')
					)
			);
			return;
		}
		if (event.event === 'continued') {
			this.stateVersion += 1;
			return;
		}
		if (event.event === 'breakpoint') {
			const body = event.body as
				| {
						breakpoint?: {
							id?: number;
							source?: { path?: string };
						};
				  }
				| undefined;
			const breakpointId = body?.breakpoint?.id;
			const sourcePath = body?.breakpoint?.source?.path;
			for (const [trackedSourcePath, requestedLines] of this.breakpointsBySource) {
				const resolved = this.requireSession().getResolvedBreakpoints(trackedSourcePath);
				if (sourcePath && sourcePath !== trackedSourcePath) continue;
				if (
					breakpointId !== undefined &&
					!resolved.some((breakpoint) => breakpoint.id === breakpointId)
				) {
					continue;
				}
				this.publishResolvedBreakpoints(resolved, requestedLines, trackedSourcePath);
			}
			return;
		}
		if (event.event === 'exited') {
			const body = event.body as { exitCode?: number } | undefined;
			this.dapExitCode = body?.exitCode ?? 0;
			return;
		}
		if (event.event === 'terminated') return;
	}

	private async resolveStoppedState(
		requestedThreadId: number | undefined,
		reason: string,
		version: number
	) {
		const session = this.requireSession();
		let threadId = requestedThreadId;
		if (!threadId) {
			const response = await session.request<{ threads?: DapThread[] }>('threads');
			threadId = response.threads?.[0]?.id;
		}
		if (!threadId) throw new Error('LLDB stopped without a WebAssembly thread.');
		const stack = await session.request<{ stackFrames?: DapStackFrame[] }>('stackTrace', {
			threadId,
			startFrame: 0,
			levels: 100
		});
		const frames = stack.stackFrames ?? [];
		const selectedFrame = frames[0];
		if (!selectedFrame) throw new Error('LLDB stopped without a stack frame.');
		const isWorkspaceFrame = this.options.artifact.sources.some(
			(source) => source.path === selectedFrame.source?.path
		);
		const scopes = isWorkspaceFrame
			? (
					(
						await session.request<{ scopes?: DapScope[] }>('scopes', {
							frameId: selectedFrame.id
						})
					).scopes ?? []
				).map(
					(scope): DebugScope => ({
						name: scope.name,
						variablesReference: scope.variablesReference,
						expensive: scope.expensive,
						variables: []
					})
				)
			: [];
		if (version !== this.stateVersion || this.session !== session) return;
		this.activeThreadId = threadId;
		this.activeFrameId = selectedFrame.id;
		const callStack = frames.map<DebugFrame>((frame) => {
			const sourcePath = frame.source?.path;
			const sourceContentSha256 = this.sourceContentSha256ByPath.get(sourcePath || '');
			return {
				id: frame.id,
				functionName: frame.name,
				line: frame.line,
				column: frame.column,
				sourcePath,
				...(sourceContentSha256 ? { sourceContentSha256 } : {})
			};
		});
		const sourceContentSha256 = this.sourceContentSha256ByPath.get(
			selectedFrame.source?.path || ''
		);
		this.options.onDebugEvent({
			type: 'pause',
			line: selectedFrame.line,
			sourcePath: selectedFrame.source?.path,
			...(sourceContentSha256 ? { sourceContentSha256 } : {}),
			reason: pauseReason(reason, this.command),
			stoppedReason: reason,
			threadId,
			frameId: selectedFrame.id,
			locals: [],
			callStack,
			scopes
		});
		this.command = null;
	}

	private finish(exitCode: number | null) {
		if (this.stopped) return;
		this.stopped = true;
		this.stateVersion += 1;
		this.inputReady = false;
		this.initialized = false;
		this.supportsEvaluateExpressions = false;
		this.dapExitCode = null;
		const session = this.session;
		this.session = undefined;
		this.options.onDebugEvent({ type: 'stop' });
		void (session?.dispose() ?? Promise.resolve()).then(
			() => {
				if (exitCode !== null && exitCode !== 0) {
					this.completionReject?.(
						new Error(`Debug target exited with code ${exitCode}.`)
					);
				} else {
					this.completionResolve?.(true);
				}
			},
			(error: unknown) =>
				this.completionReject?.(
					error instanceof Error
						? error
						: new Error('Unable to dispose the LLDB debug session.')
				)
		);
	}

	private fail(error: Error) {
		if (this.stopped) return;
		this.stopped = true;
		this.stateVersion += 1;
		this.inputReady = false;
		this.initialized = false;
		this.supportsEvaluateExpressions = false;
		this.dapExitCode = null;
		const session = this.session;
		this.session = undefined;
		this.options.onDebugEvent({ type: 'stop' });
		void (session?.dispose() ?? Promise.resolve()).then(
			() => this.completionReject?.(error),
			() => this.completionReject?.(error)
		);
	}

	private requireSession() {
		if (!this.session) throw new Error('LLDB sandbox session is not running.');
		return this.session;
	}

	private publishResolvedBreakpoints(
		breakpoints: Array<{ verified?: boolean; line?: number; message?: string }>,
		requestedLines: number[],
		sourcePath = this.options.sourcePath
	) {
		const sourceContentSha256 = this.sourceContentSha256ByPath.get(sourcePath);
		this.options.onDebugEvent({
			type: 'breakpoints',
			sourcePath,
			...(sourceContentSha256 ? { sourceContentSha256 } : {}),
			breakpoints: requestedLines.map((requestedLine, index) => ({
				requestedLine,
				line: breakpoints[index]?.line ?? requestedLine,
				verified: breakpoints[index]?.verified === true,
				message: breakpoints[index]?.message
			}))
		});
	}

	private async flushInput() {
		if (!this.inputReady || !this.session) return;
		while (this.pendingInput.length > 0) {
			await this.session.writeStdin(this.pendingInput.shift() || '');
		}
		if (this.pendingEof) {
			this.pendingEof = false;
			await this.session.closeStdin();
		}
	}
}
