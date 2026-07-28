import type {
	DebugCommand,
	DebugMemory,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable
} from './debug.js';
import type { ExecutionLimits, ExecutionRequest, ExecutionResult } from './execution.js';
import type { ProgressLike } from './progress.js';
import type { RuntimeAssetKeySource } from './runtime-assets.js';
import {
	DEFAULT_WORKSPACE_LIMITS,
	WorkspaceValidationError,
	normalizeWorkspacePath,
	validateWorkspaceFiles,
	type WorkspaceFile,
	type WorkspaceLimits
} from './workspace.js';

export type SandboxRuntimeAssets = string | RuntimeAssetKeySource;
export type SandboxProgress = ProgressLike;

export interface SandboxExecutionOptions {
	[key: string]: unknown;
	activePath?: string;
	env?: Record<string, string>;
	limits?: Partial<ExecutionLimits>;
	signal?: AbortSignal;
	sourceBreakpoints?: DebugSourceBreakpoints[];
	stdin?: string | AsyncIterable<Uint8Array>;
	workspaceFiles?: WorkspaceFile[];
	workspaceLimits?: Partial<WorkspaceLimits>;
}

export interface Sandbox {
	constructor: unknown;
	eof: () => void;
	load: (
		runtimeAssets?: SandboxRuntimeAssets,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	run: (
		code: string,
		prepare: boolean,
		log?: boolean,
		prog?: SandboxProgress,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	execute?: (request: ExecutionRequest) => Promise<ExecutionResult>;
	terminate: () => void | Promise<void>;
	clear: () => Promise<void>;
	kill?: () => void | Promise<void>;
	write?: (data: string) => void;
	output?: (data: string) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	oncompilerdiagnostic?: (diagnostic: unknown) => void;
	debugCommand?: (command: DebugCommand) => void | Promise<void>;
	debugPause?: () => void | Promise<void>;
	setBreakpoints?: (lines: number[], sourcePath?: string) => void | Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	debugVariables?: (
		variablesReference: number,
		start?: number,
		count?: number
	) => Promise<DebugVariable[]>;
	debugReadMemory?: (
		memoryReference: string,
		offset: number,
		count: number
	) => Promise<DebugMemory | null>;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	elapse?: number;
}

export interface BoundSandbox extends Omit<Sandbox, 'load'> {
	load: (
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundTerminalProps {
	playground: PlaygroundBinding;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundBinding {
	runtimeAssets: SandboxRuntimeAssets;
	terminalProps: PlaygroundTerminalProps;
	load: (language: string) => Promise<BoundSandbox>;
}

export type SandboxLoader = (language: string) => Promise<Sandbox>;

const workspaceTextEncoder = new TextEncoder();

function validateSandboxExecutionOptions(
	code: string,
	options: SandboxExecutionOptions
): SandboxExecutionOptions {
	const workspaceFiles = validateWorkspaceFiles(
		options.workspaceFiles ?? [],
		options.workspaceLimits
	);
	const activePath =
		options.activePath === undefined ? undefined : normalizeWorkspacePath(options.activePath);

	if (activePath !== undefined) {
		validateWorkspaceFiles(
			[
				...workspaceFiles.filter((file) => file.path !== activePath),
				{ path: activePath, content: code }
			],
			options.workspaceLimits
		);
	} else {
		const maxFiles = options.workspaceLimits?.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles;
		const maxFileBytes =
			options.workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes;
		const maxTotalBytes =
			options.workspaceLimits?.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes;
		const sourceBytes = workspaceTextEncoder.encode(code).byteLength;
		if (workspaceFiles.length + 1 > maxFiles) {
			throw new WorkspaceValidationError(
				'file-count-limit',
				`Workspace plus active source contains ${workspaceFiles.length + 1} files; limit is ${maxFiles}`,
				{ limit: maxFiles, actual: workspaceFiles.length + 1 }
			);
		}
		if (sourceBytes > maxFileBytes) {
			throw new WorkspaceValidationError(
				'file-size-limit',
				`Active source is ${sourceBytes} bytes; limit is ${maxFileBytes}`,
				{ limit: maxFileBytes, actual: sourceBytes }
			);
		}
		let totalBytes = sourceBytes;
		for (const file of workspaceFiles) {
			totalBytes +=
				typeof file.content === 'string'
					? workspaceTextEncoder.encode(file.content).byteLength
					: file.content.byteLength;
		}
		if (totalBytes > maxTotalBytes) {
			throw new WorkspaceValidationError(
				'total-size-limit',
				`Workspace plus active source is ${totalBytes} bytes; limit is ${maxTotalBytes}`,
				{ limit: maxTotalBytes, actual: totalBytes }
			);
		}
	}

	return {
		...options,
		...(options.activePath === undefined ? {} : { activePath }),
		...(options.workspaceFiles === undefined ? {} : { workspaceFiles })
	};
}

function bindRuntimeAssets(sandbox: Sandbox, runtimeAssets: SandboxRuntimeAssets): BoundSandbox {
	return new Proxy(sandbox, {
		get(target, prop, receiver) {
			if (prop === 'runtimeAssets') return runtimeAssets;
			if (prop === 'load') {
				return async (
					code = '',
					log = true,
					args: string[] = [],
					options: SandboxExecutionOptions = {},
					progress?: SandboxProgress
				) =>
					target.load(
						runtimeAssets,
						code,
						log,
						args,
						validateSandboxExecutionOptions(code, options),
						progress
					);
			}
			if (prop === 'run') {
				return async (
					code: string,
					prepare: boolean,
					log?: boolean,
					progress?: SandboxProgress,
					args?: string[],
					options: SandboxExecutionOptions = {}
				) =>
					target.run(
						code,
						prepare,
						log,
						progress,
						args,
						validateSandboxExecutionOptions(code, options)
					);
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value, receiver) {
			return Reflect.set(target, prop, value, receiver);
		}
	}) as BoundSandbox;
}

export function createPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader
): PlaygroundBinding {
	const binding = {
		runtimeAssets,
		terminalProps: {} as PlaygroundBinding['terminalProps'],
		async load(language: string) {
			return bindRuntimeAssets(await loadSandbox(language), runtimeAssets);
		}
	} as PlaygroundBinding;
	binding.terminalProps = {
		playground: binding,
		runtimeAssets
	};
	return binding;
}
