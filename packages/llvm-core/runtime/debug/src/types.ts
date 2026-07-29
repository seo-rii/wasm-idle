import type {
	RuntimeClangdConfig,
	RuntimeCompilerConfig,
	RuntimeManifestTarget,
	SupportedClangTarget
} from '../../clang/src/types.js';

export type DebugSessionGeneration = string;

export interface DebugSourceFile {
	path: `/workspace/${string}`;
	content: string;
	contentSha256?: string;
}

export interface DebugSource {
	name?: string;
	path: string;
	sourceReference?: number;
}

export interface ResolvedBreakpoint {
	id?: number;
	verified: boolean;
	line?: number;
	column?: number;
	message?: string;
	source?: DebugSource;
}

export interface DebugThread {
	id: number;
	name: string;
}

export interface DebugStackFrame {
	id: number;
	name: string;
	source?: DebugSource;
	line: number;
	column: number;
	instructionPointerReference?: string;
}

export interface DebugScope {
	name: string;
	variablesReference: number;
	expensive: boolean;
	presentationHint?: string;
	namedVariables?: number;
	indexedVariables?: number;
}

export interface DebugVariable {
	name: string;
	value: string;
	type?: string;
	evaluateName?: string;
	variablesReference: number;
	memoryReference?: string;
	namedVariables?: number;
	indexedVariables?: number;
}

export interface DebugMemory {
	address: string;
	data?: string;
	unreadableBytes?: number;
}

export interface DebugEvaluateResult {
	result: string;
	type?: string;
	variablesReference: number;
	memoryReference?: string;
}

export interface DebugCapabilities {
	supportsConfigurationDoneRequest?: boolean;
	supportsReadMemoryRequest?: boolean;
	supportsEvaluateForHovers?: boolean;
	supportsConditionalBreakpoints?: boolean;
	supportsLogPoints?: boolean;
	supportsDataBreakpoints?: boolean;
	supportsTerminateRequest?: boolean;
}

export interface DapProtocolMessage {
	seq: number;
	type: 'request' | 'response' | 'event';
}

export interface DapRequest<TArguments = unknown> extends DapProtocolMessage {
	type: 'request';
	command: string;
	arguments?: TArguments;
}

export interface DapResponse<TBody = unknown> extends DapProtocolMessage {
	type: 'response';
	request_seq: number;
	success: boolean;
	command: string;
	message?: string;
	body?: TBody;
}

export interface DapEvent<TBody = unknown> extends DapProtocolMessage {
	type: 'event';
	event: string;
	body?: TBody;
}

export type DapMessage = DapRequest | DapResponse | DapEvent;

export interface DapRequestOptions {
	/** Override the client response timeout. Set to `null` for commands that resolve on a later stop. */
	responseTimeoutMs?: number | null;
}

export interface DapRequestSession {
	request<TBody = unknown>(
		command: string,
		args?: unknown,
		options?: DapRequestOptions
	): Promise<TBody>;
	onEvent(listener: (event: DapEvent) => void): () => void;
}

export interface RuntimeDebugAsset {
	js: string;
	wasm: string;
	worker: string;
	jsSha256: string;
	wasmSha256: string;
	workerSha256: string;
}

export interface RuntimeLldbAsset extends RuntimeDebugAsset {
	llvmVersion: string;
	llvmRevision: string;
	patchesSha256: string;
}

export interface RuntimeWamrAsset extends RuntimeDebugAsset {
	name: 'wamr';
	revision: string;
}

export interface RuntimeDebugCapabilities {
	breakpoints: boolean;
	stepping: boolean;
	stackTrace: boolean;
	locals: boolean;
	globals: boolean;
	readMemory: boolean;
	evaluateExpressions: boolean;
	dataBreakpoints: boolean;
	wasmThreads: boolean;
}

export interface RuntimeDebuggerConfig {
	protocolVersion: 1;
	transport: 'shared-ring-v1';
	lldb: RuntimeLldbAsset;
	targetRuntime: RuntimeWamrAsset;
	capabilities: RuntimeDebugCapabilities;
}

export interface RuntimeManifestV2 {
	manifestVersion: 2;
	version: string;
	defaultTarget: SupportedClangTarget;
	compiler: RuntimeCompilerConfig;
	targets: Record<SupportedClangTarget, RuntimeManifestTarget>;
	clangd: RuntimeClangdConfig;
	debugger: RuntimeDebuggerConfig;
}

export interface DebugRuntimeAssets {
	lldb: {
		js: URL;
		wasm: URL;
		worker: URL;
	};
	targetRuntime: {
		js: URL;
		wasm: URL;
		worker: URL;
	};
}

export interface DebugLaunchConfig {
	program: '/workspace/program.wasm';
	stopOnEntry?: boolean;
	args?: string[];
	env?: Record<string, string>;
	cwd?: '/workspace';
}

export interface DebugBreakpointConfiguration {
	source: DebugSource;
	lines: number[];
}

export type DebugWorkerKind = 'lldb' | 'target';

export interface SharedByteQueueDescriptor {
	control: SharedArrayBuffer;
	data: SharedArrayBuffer;
	generation: number;
}

export interface LldbWorkerInitializeMessage {
	type: 'initialize-lldb';
	generation: DebugSessionGeneration;
	module: Uint8Array;
	sources: DebugSourceFile[];
	dapInput: SharedByteQueueDescriptor;
	dapOutput: SharedByteQueueDescriptor;
	rspInput: SharedByteQueueDescriptor;
	rspOutput: SharedByteQueueDescriptor;
	assets: {
		js: string;
		wasm: string;
		worker: string;
	};
}

export interface TargetWorkerInitializeMessage {
	type: 'initialize-target';
	generation: DebugSessionGeneration;
	module: Uint8Array;
	args?: string[];
	env?: Record<string, string>;
	cwd?: '/workspace';
	workspaceFiles: DebugSourceFile[];
	rspInput: SharedByteQueueDescriptor;
	rspOutput: SharedByteQueueDescriptor;
	stdout: SharedByteQueueDescriptor;
	stderr: SharedByteQueueDescriptor;
	assets: {
		js: string;
		wasm: string;
		worker: string;
	};
	stdin?: SharedByteQueueDescriptor;
}

export type DebugWorkerInboundMessage =
	| LldbWorkerInitializeMessage
	| TargetWorkerInitializeMessage
	| {
			type: 'interrupt-target';
			generation: DebugSessionGeneration;
	  }
	| {
			type: 'dispose';
			generation: DebugSessionGeneration;
	  };

export type DebugWorkerOutboundMessage =
	| {
			type: 'ready';
			worker: DebugWorkerKind;
			generation: DebugSessionGeneration;
	  }
	| {
			type: 'output';
			channel: 'stdout' | 'stderr';
			data: string;
			generation: DebugSessionGeneration;
	  }
	| {
			type: 'exit';
			exitCode: number | null;
			generation: DebugSessionGeneration;
	  }
	| {
			type: 'error';
			worker: DebugWorkerKind;
			message: string;
			generation: DebugSessionGeneration;
	  };

export interface WorkerLike {
	postMessage(message: DebugWorkerInboundMessage): void;
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerOutboundMessage>) => void
	): void;
	removeEventListener(
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerOutboundMessage>) => void
	): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(
		type: 'messageerror',
		listener: (event: MessageEvent<unknown>) => void
	): void;
	terminate(): void;
}

export interface BrowserLldbSessionOptions {
	manifest: RuntimeManifestV2;
	runtimeBaseUrl: string | URL;
	module: Uint8Array | ArrayBuffer;
	moduleSha256?: string;
	sources: DebugSourceFile[];
	breakpoints?: DebugBreakpointConfiguration[];
	launch?: Partial<DebugLaunchConfig>;
	/** Test/embedding hook. Production callers should normally use the bundled worker factory. */
	workerFactory?: (kind: DebugWorkerKind) => WorkerLike;
	queueCapacity?: number;
	/** DAP response timeout, started after a complete request frame is written. */
	requestTimeoutMs?: number;
	/** Maximum time a request frame may remain blocked by transport backpressure. */
	transportWriteTimeoutMs?: number;
	readyTimeoutMs?: number;
	fetchImpl?: typeof fetch;
	onOutput?: (channel: 'stdout' | 'stderr', data: string) => void;
	onLifecycle?: (
		event:
			| { type: 'worker-error'; worker: DebugWorkerKind; message: string }
			| { type: 'target-exit'; exitCode: number | null }
	) => void;
}
