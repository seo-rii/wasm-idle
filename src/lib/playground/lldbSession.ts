import type {
	DebugCommand,
	DebugFrame,
	DebugMemory,
	DebugPauseReason,
	DebugScope,
	DebugSessionEvent,
	DebugVariable
} from '$lib/playground/options';
import { ProtocolError } from '@wasm-idle/core';
import {
	createBrowserLldbSession,
	DapProtocolError,
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

function invalidDapPayload(subject: string, path: string, expectation: string): never {
	throw new ProtocolError(`Invalid LLDB DAP ${subject} at ${path}: ${expectation}.`);
}

function invalidDapResponse(command: string, path: string, expectation: string): never {
	invalidDapPayload(`${command} response`, path, expectation);
}

function assertDapRecord(
	value: unknown,
	command: string,
	path: string
): asserts value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		invalidDapResponse(command, path, 'expected an object');
	}
}

function assertDapString(value: unknown, command: string, path: string): asserts value is string {
	if (typeof value !== 'string') invalidDapResponse(command, path, 'expected a string');
}

function assertDapBoolean(value: unknown, command: string, path: string): asserts value is boolean {
	if (typeof value !== 'boolean') invalidDapResponse(command, path, 'expected a boolean');
}

function assertDapPositiveSafeInteger(
	value: unknown,
	subject: string,
	path: string
): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		invalidDapPayload(subject, path, 'expected a positive safe integer');
	}
}

function assertDapNonNegativeSafeInteger(
	value: unknown,
	command: string,
	path: string
): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		invalidDapResponse(command, path, 'expected a non-negative safe integer');
	}
}

function dapResponseCollection(response: unknown, command: string, path: string): unknown[] {
	assertDapRecord(response, command, 'body');
	const collection = response[path];
	if (!Array.isArray(collection)) invalidDapResponse(command, path, 'expected an array');
	return collection;
}

function dapOptionalNonNegativeSafeInteger(
	record: Record<string, unknown>,
	property: string,
	command: string,
	path: string
) {
	const value = record[property];
	if (value === undefined) return undefined;
	assertDapNonNegativeSafeInteger(value, command, `${path}.${property}`);
	return value;
}

function snapshotBreakpointLines(lines: readonly number[]) {
	if (lines.some((line) => !Number.isSafeInteger(line) || line < 1)) {
		throw new RangeError('LLDB breakpoint lines must be positive safe integers.');
	}
	return [...lines];
}

function assertPositiveSafeIntegerArgument(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
}

function assertNonNegativeSafeIntegerArgument(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
}

export class LldbSandboxSession {
	private session?: BrowserLldbSession;
	private activeThreadId = 1;
	private activeFrameId?: number;
	private command: DebugCommand | null = null;
	private pauseRequested = false;
	private pauseRequestVersion = 0;
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
	private supportsReadMemory = false;
	private supportsWriteMemory = false;
	private breakpointVersion = 0;
	private scopeRequestVersion = 0;
	private dapExitCode: number | null = null;
	private readonly breakpointsBySource = new Map<`/workspace/${string}`, number[]>();
	private readonly breakpointRequestVersions = new Map<string, number>();
	private readonly sourceContentSha256ByPath = new Map<string, string>();

	constructor(private readonly options: LldbSandboxSessionOptions) {
		const sourceBreakpoints = options.sourceBreakpoints?.length
			? options.sourceBreakpoints
			: [{ sourcePath: options.sourcePath, lines: options.breakpoints }];
		for (const { sourcePath, lines } of sourceBreakpoints) {
			this.breakpointsBySource.set(sourcePath, snapshotBreakpointLines(lines));
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
		this.pauseRequested = false;
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
		this.supportsReadMemory = manifest.debugger?.capabilities?.readMemory === true;
		this.supportsWriteMemory = manifest.debugger?.capabilities?.writeMemory === true;
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
				try {
					this.handleDapEvent(event);
				} catch (error) {
					if (!(error instanceof ProtocolError)) throw error;
					this.fail(error);
				}
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
			if (lifecycleVersion !== this.lifecycleVersion) {
				await session.dispose();
				return completion;
			}
			if (this.session === session) {
				this.fail(
					this.asProtocolError(error) ??
						(error instanceof Error
							? error
							: new Error('Unable to initialize the LLDB debug session.'))
				);
				return completion;
			}
			await session.dispose();
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
		this.pauseRequested = false;
		const dapCommand =
			command === 'stepInto'
				? 'stepIn'
				: command === 'nextLine'
					? 'next'
					: command === 'stepOut'
						? 'stepOut'
						: 'continue';
		const stateVersion = ++this.stateVersion;
		const request = session.request(
			dapCommand,
			{ threadId: this.activeThreadId },
			{ responseTimeoutMs: null }
		);
		this.options.onDebugEvent({ type: 'resume', command });
		void request.catch((error: unknown) => {
			if (this.session !== session || this.stateVersion !== stateVersion) return;
			this.fail(
				error instanceof Error
					? error
					: new Error(`Unable to send the LLDB ${dapCommand} request.`)
			);
		});
	}

	async pause() {
		const session = this.requireSession();
		const requestVersion = ++this.pauseRequestVersion;
		this.pauseRequested = true;
		try {
			await session.request('pause', {
				threadId: this.activeThreadId
			});
		} catch (error) {
			if (
				this.session !== session ||
				this.pauseRequestVersion !== requestVersion ||
				!this.pauseRequested
			) {
				return;
			}
			this.pauseRequested = false;
			throw error;
		}
	}

	async setBreakpoints(lines: number[], sourcePath = this.options.sourcePath) {
		const requestedLines = snapshotBreakpointLines(lines);
		this.breakpointsBySource.set(sourcePath, requestedLines);
		this.breakpointVersion += 1;
		const requestVersion = (this.breakpointRequestVersions.get(sourcePath) ?? 0) + 1;
		this.breakpointRequestVersions.set(sourcePath, requestVersion);
		if (!this.session || !this.initialized) return;
		const session = this.requireSession();
		let breakpoints: Array<{ verified?: boolean; line?: number; message?: string }>;
		try {
			breakpoints = await session.setBreakpoints({ path: sourcePath }, requestedLines);
		} catch (error) {
			if (
				this.session !== session ||
				this.breakpointRequestVersions.get(sourcePath) !== requestVersion
			) {
				return;
			}
			this.rethrowProtocolError(error);
			throw error;
		}
		if (
			this.session !== session ||
			this.breakpointRequestVersions.get(sourcePath) !== requestVersion
		) {
			return;
		}
		this.publishResolvedBreakpoints(breakpoints, requestedLines, sourcePath);
	}

	async evaluate(expression: string) {
		if (!this.supportsEvaluateExpressions || !this.activeFrameId) return '?';
		const session = this.requireSession();
		const stateVersion = this.stateVersion;
		const scopeRequestVersion = this.scopeRequestVersion;
		const frameId = this.activeFrameId;
		try {
			const response = await session.request<unknown>('evaluate', {
				expression,
				frameId,
				context: 'watch'
			});
			if (!this.isCurrentValueRequest(session, stateVersion, scopeRequestVersion)) {
				return '?';
			}
			assertDapRecord(response, 'evaluate', 'body');
			assertDapString(response.result, 'evaluate', 'result');
			assertDapNonNegativeSafeInteger(
				response.variablesReference,
				'evaluate',
				'variablesReference'
			);
			return response.result;
		} catch (error) {
			if (!this.isCurrentValueRequest(session, stateVersion, scopeRequestVersion)) {
				return '?';
			}
			this.rethrowProtocolError(error);
			return '?';
		}
	}

	async variables(variablesReference: number, start?: number, count?: number) {
		assertPositiveSafeIntegerArgument(variablesReference, 'variablesReference');
		if (start !== undefined) assertNonNegativeSafeIntegerArgument(start, 'start');
		if (count !== undefined) assertNonNegativeSafeIntegerArgument(count, 'count');
		const session = this.requireSession();
		const stateVersion = this.stateVersion;
		const scopeRequestVersion = this.scopeRequestVersion;
		try {
			const response = await session.request<unknown>('variables', {
				variablesReference,
				...(start === undefined ? {} : { start }),
				...(count === undefined ? {} : { count })
			});
			if (!this.isCurrentValueRequest(session, stateVersion, scopeRequestVersion)) {
				return [];
			}
			return dapResponseCollection(response, 'variables', 'variables').map<DebugVariable>(
				(variable, index) => {
					const path = `variables[${index}]`;
					assertDapRecord(variable, 'variables', path);
					assertDapString(variable.name, 'variables', `${path}.name`);
					assertDapString(variable.value, 'variables', `${path}.value`);
					assertDapNonNegativeSafeInteger(
						variable.variablesReference,
						'variables',
						`${path}.variablesReference`
					);
					const type = variable.type;
					if (type !== undefined) assertDapString(type, 'variables', `${path}.type`);
					const evaluateName = variable.evaluateName;
					if (evaluateName !== undefined) {
						assertDapString(evaluateName, 'variables', `${path}.evaluateName`);
					}
					const memoryReference = variable.memoryReference;
					if (memoryReference !== undefined) {
						assertDapString(memoryReference, 'variables', `${path}.memoryReference`);
					}
					const namedVariables = dapOptionalNonNegativeSafeInteger(
						variable,
						'namedVariables',
						'variables',
						path
					);
					const indexedVariables = dapOptionalNonNegativeSafeInteger(
						variable,
						'indexedVariables',
						'variables',
						path
					);
					return {
						name: variable.name,
						value: variable.value,
						type,
						...(evaluateName === undefined ? {} : { evaluateName }),
						variablesReference: variable.variablesReference,
						memoryReference,
						...(namedVariables === undefined ? {} : { namedVariables }),
						...(indexedVariables === undefined ? {} : { indexedVariables })
					};
				}
			);
		} catch (error) {
			if (!this.isCurrentValueRequest(session, stateVersion, scopeRequestVersion)) {
				return [];
			}
			this.rethrowProtocolError(error);
			throw error;
		}
	}

	async scopes(frameId: number) {
		assertPositiveSafeIntegerArgument(frameId, 'frameId');
		const session = this.requireSession();
		const stateVersion = this.stateVersion;
		const requestVersion = ++this.scopeRequestVersion;
		try {
			const scopes = await this.requestScopes(session, frameId);
			if (
				this.session === session &&
				this.stateVersion === stateVersion &&
				this.scopeRequestVersion === requestVersion
			) {
				this.activeFrameId = frameId;
			}
			return scopes;
		} catch (error) {
			if (
				this.session !== session ||
				this.stateVersion !== stateVersion ||
				this.scopeRequestVersion !== requestVersion
			) {
				throw error;
			}
			this.rethrowProtocolError(error);
			throw error;
		}
	}

	async readMemory(
		memoryReference: string,
		offset: number,
		count: number
	): Promise<DebugMemory | null> {
		if (!this.supportsReadMemory) return null;
		if (!Number.isSafeInteger(offset)) {
			throw new RangeError('offset must be a safe integer.');
		}
		assertNonNegativeSafeIntegerArgument(count, 'count');
		const session = this.requireSession();
		const stateVersion = this.stateVersion;
		try {
			const response = await session.request<unknown>('readMemory', {
				memoryReference,
				offset,
				count
			});
			if (!this.isCurrentValueRequest(session, stateVersion)) return null;
			assertDapRecord(response, 'readMemory', 'body');
			assertDapString(response.address, 'readMemory', 'address');
			const encodedData = response.data;
			if (encodedData !== undefined) assertDapString(encodedData, 'readMemory', 'data');
			const unreadableBytes = response.unreadableBytes;
			if (unreadableBytes !== undefined) {
				assertDapNonNegativeSafeInteger(unreadableBytes, 'readMemory', 'unreadableBytes');
			}
			let binary: string;
			try {
				binary = globalThis.atob(encodedData ?? '');
			} catch {
				invalidDapResponse('readMemory', 'data', 'expected valid Base64');
			}
			if (binary.length > count) {
				invalidDapResponse(
					'readMemory',
					'data',
					`decoded ${binary.length} bytes for a ${count}-byte request`
				);
			}
			if (binary.length + (unreadableBytes ?? 0) > count) {
				invalidDapResponse(
					'readMemory',
					'unreadableBytes',
					`reported ${binary.length} readable and ${unreadableBytes ?? 0} unreadable bytes for a ${count}-byte request`
				);
			}
			const data = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				data[index] = binary.charCodeAt(index);
			}
			return {
				address: response.address,
				data,
				unreadableBytes: unreadableBytes ?? 0
			};
		} catch (error) {
			if (!this.isCurrentValueRequest(session, stateVersion)) return null;
			this.rethrowProtocolError(error);
			throw error;
		}
	}

	async writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial = false
	): Promise<{ offset?: number; bytesWritten: number } | null> {
		if (!this.supportsWriteMemory) return null;
		if (!Number.isSafeInteger(offset)) {
			throw new RangeError('offset must be a safe integer.');
		}
		const chunks: string[] = [];
		for (let start = 0; start < data.byteLength; start += 0x8000) {
			chunks.push(String.fromCharCode(...data.subarray(start, start + 0x8000)));
		}
		const session = this.requireSession();
		const stateVersion = this.stateVersion;
		try {
			const response = await session.request<unknown>('writeMemory', {
				memoryReference,
				offset,
				allowPartial,
				data: globalThis.btoa(chunks.join(''))
			});
			if (!this.isCurrentValueRequest(session, stateVersion)) return null;
			assertDapRecord(response, 'writeMemory', 'body');
			assertDapNonNegativeSafeInteger(response.bytesWritten, 'writeMemory', 'bytesWritten');
			if (response.bytesWritten > data.byteLength) {
				invalidDapResponse(
					'writeMemory',
					'bytesWritten',
					`reported ${response.bytesWritten} bytes written for ${data.byteLength} input bytes`
				);
			}
			const responseOffset = response.offset;
			if (
				responseOffset !== undefined &&
				(typeof responseOffset !== 'number' || !Number.isSafeInteger(responseOffset))
			) {
				invalidDapResponse('writeMemory', 'offset', 'expected a safe integer');
			}
			return {
				...(responseOffset === undefined ? {} : { offset: responseOffset }),
				bytesWritten: response.bytesWritten
			};
		} catch (error) {
			if (!this.isCurrentValueRequest(session, stateVersion)) return null;
			this.rethrowProtocolError(error);
			throw error;
		}
	}

	async disconnect() {
		this.lifecycleVersion += 1;
		this.stateVersion += 1;
		this.inputReady = false;
		this.initialized = false;
		this.supportsEvaluateExpressions = false;
		this.supportsReadMemory = false;
		this.supportsWriteMemory = false;
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
			if (
				typeof event.body !== 'object' ||
				event.body === null ||
				Array.isArray(event.body)
			) {
				invalidDapPayload('stopped event', 'body', 'expected an object');
			}
			const body = event.body as Record<string, unknown>;
			if (typeof body.reason !== 'string') {
				invalidDapPayload('stopped event', 'reason', 'expected a string');
			}
			const threadId = body.threadId;
			if (threadId !== undefined) {
				assertDapPositiveSafeInteger(threadId, 'stopped event', 'threadId');
			}
			if (
				body.allThreadsStopped !== undefined &&
				typeof body.allThreadsStopped !== 'boolean'
			) {
				invalidDapPayload('stopped event', 'allThreadsStopped', 'expected a boolean');
			}
			const reason =
				this.pauseRequested && body.reason === 'exception' ? 'pause' : body.reason;
			this.pauseRequested = false;
			const session = this.requireSession();
			const version = ++this.stateVersion;
			void this.resolveStoppedState(threadId, reason, version).catch((error) => {
				if (version !== this.stateVersion || this.session !== session) return;
				this.fail(
					error instanceof Error ? error : new Error('Unable to read LLDB stopped state.')
				);
			});
			return;
		}
		if (event.event === 'continued') {
			if (
				typeof event.body !== 'object' ||
				event.body === null ||
				Array.isArray(event.body)
			) {
				invalidDapPayload('continued event', 'body', 'expected an object');
			}
			const body = event.body as Record<string, unknown>;
			assertDapPositiveSafeInteger(body.threadId, 'continued event', 'threadId');
			if (
				body.allThreadsContinued !== undefined &&
				typeof body.allThreadsContinued !== 'boolean'
			) {
				invalidDapPayload('continued event', 'allThreadsContinued', 'expected a boolean');
			}
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
				if (breakpointId !== undefined) {
					if (!resolved.some((breakpoint) => breakpoint.id === breakpointId)) continue;
				} else {
					if (sourcePath && sourcePath !== trackedSourcePath) continue;
				}
				this.publishResolvedBreakpoints(resolved, requestedLines, trackedSourcePath);
			}
			return;
		}
		if (event.event === 'exited') {
			if (
				typeof event.body !== 'object' ||
				event.body === null ||
				Array.isArray(event.body)
			) {
				invalidDapPayload('exited event', 'body', 'expected an object');
			}
			const exitCode = (event.body as Record<string, unknown>).exitCode;
			if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
				invalidDapPayload('exited event', 'exitCode', 'expected a safe integer');
			}
			this.dapExitCode = exitCode;
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
		if (threadId === undefined) {
			const response = await session.request<unknown>('threads');
			const threads = dapResponseCollection(response, 'threads', 'threads').map<DapThread>(
				(thread, index) => {
					const path = `threads[${index}]`;
					assertDapRecord(thread, 'threads', path);
					assertDapPositiveSafeInteger(thread.id, 'threads response', `${path}.id`);
					assertDapString(thread.name, 'threads', `${path}.name`);
					return { id: thread.id, name: thread.name };
				}
			);
			threadId = threads[0]?.id;
		}
		if (!threadId) throw new Error('LLDB stopped without a WebAssembly thread.');
		const response = await session.request<unknown>('stackTrace', {
			threadId,
			startFrame: 0,
			levels: 100
		});
		const frames = dapResponseCollection(
			response,
			'stackTrace',
			'stackFrames'
		).map<DapStackFrame>((frame, index) => {
			const path = `stackFrames[${index}]`;
			assertDapRecord(frame, 'stackTrace', path);
			assertDapPositiveSafeInteger(frame.id, 'stackTrace response', `${path}.id`);
			assertDapString(frame.name, 'stackTrace', `${path}.name`);
			assertDapNonNegativeSafeInteger(frame.line, 'stackTrace', `${path}.line`);
			assertDapNonNegativeSafeInteger(frame.column, 'stackTrace', `${path}.column`);
			let source: { path?: string } | undefined;
			if (frame.source !== undefined) {
				assertDapRecord(frame.source, 'stackTrace', `${path}.source`);
				const sourcePath = frame.source.path;
				if (sourcePath !== undefined) {
					assertDapString(sourcePath, 'stackTrace', `${path}.source.path`);
				}
				source = sourcePath === undefined ? {} : { path: sourcePath };
			}
			return {
				id: frame.id,
				name: frame.name,
				source,
				line: frame.line,
				column: frame.column
			};
		});
		const selectedFrame = frames[0];
		if (!selectedFrame) throw new Error('LLDB stopped without a stack frame.');
		const isWorkspaceFrame = this.options.artifact.sources.some(
			(source) => source.path === selectedFrame.source?.path
		);
		const scopes = isWorkspaceFrame ? await this.requestScopes(session, selectedFrame.id) : [];
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

	private async requestScopes(session: BrowserLldbSession, frameId: number) {
		const response = await session.request<unknown>('scopes', { frameId });
		return dapResponseCollection(response, 'scopes', 'scopes').map(
			(scope, index): DebugScope => {
				const path = `scopes[${index}]`;
				assertDapRecord(scope, 'scopes', path);
				assertDapString(scope.name, 'scopes', `${path}.name`);
				assertDapNonNegativeSafeInteger(
					scope.variablesReference,
					'scopes',
					`${path}.variablesReference`
				);
				assertDapBoolean(scope.expensive, 'scopes', `${path}.expensive`);
				const namedVariables = dapOptionalNonNegativeSafeInteger(
					scope,
					'namedVariables',
					'scopes',
					path
				);
				const indexedVariables = dapOptionalNonNegativeSafeInteger(
					scope,
					'indexedVariables',
					'scopes',
					path
				);
				return {
					name: scope.name,
					variablesReference: scope.variablesReference,
					...(namedVariables === undefined ? {} : { namedVariables }),
					...(indexedVariables === undefined ? {} : { indexedVariables }),
					expensive: scope.expensive,
					variables: []
				};
			}
		);
	}

	private isCurrentValueRequest(
		session: BrowserLldbSession,
		stateVersion: number,
		scopeRequestVersion?: number
	) {
		return (
			this.session === session &&
			this.stateVersion === stateVersion &&
			(scopeRequestVersion === undefined || this.scopeRequestVersion === scopeRequestVersion)
		);
	}

	private rethrowProtocolError(error: unknown) {
		const protocolError = this.asProtocolError(error);
		if (!protocolError) return;
		this.fail(protocolError);
		throw protocolError;
	}

	private asProtocolError(error: unknown) {
		if (error instanceof ProtocolError) return error;
		if (error instanceof DapProtocolError) {
			return new ProtocolError(error.message, { cause: error });
		}
		return null;
	}

	private finish(exitCode: number | null) {
		if (this.stopped) return;
		this.stopped = true;
		this.stateVersion += 1;
		this.inputReady = false;
		this.initialized = false;
		this.supportsEvaluateExpressions = false;
		this.supportsReadMemory = false;
		this.supportsWriteMemory = false;
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
		this.supportsReadMemory = false;
		this.supportsWriteMemory = false;
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
