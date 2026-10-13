import {
	createPlaygroundBinding,
	RuntimeConfigurationError,
	type BoundSandbox,
	type ExecutionRequest,
	type ExecutionResult,
	type PlaygroundBinding,
	type SandboxExecutionOptions,
	type SandboxLoader,
	type SandboxProgress,
	type SandboxRuntimeAssets
} from '@wasm-idle/core';
import { pathToFileURL } from 'node:url';

export interface NodeSandboxOptions {
	language: string;
	runtimeAssets?: SandboxRuntimeAssets;
	loadSandbox?: SandboxLoader;
	playground?: PlaygroundBinding;
}

export interface NodeRunOptions extends NodeSandboxOptions {
	code: string;
	log?: boolean;
	args?: string[];
	executionOptions?: SandboxExecutionOptions;
	progress?: SandboxProgress;
	stdin?: string;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	clearAfterRun?: boolean;
	disposeAfterRun?: boolean;
}

export interface NodeExecuteOptions extends NodeSandboxOptions {
	request: ExecutionRequest;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	disposeAfterRun?: boolean;
}

export interface NodeRunResult {
	ok: boolean;
	result: boolean | string;
	elapsedMs: number;
	error?: unknown;
	cleanupErrors?: readonly unknown[];
}

export interface NodeExecutionResult extends ExecutionResult {
	cleanupErrors?: readonly unknown[];
}

/** A thrown execution error and independent cleanup errors, with the original in cause. */
export class NodeExecutionCleanupError extends AggregateError {
	readonly cleanupErrors: readonly unknown[];

	constructor(error: unknown, cleanupErrors: readonly unknown[]) {
		super([error, ...cleanupErrors], 'Runtime execution and cleanup failed', { cause: error });
		this.name = 'NodeExecutionCleanupError';
		this.cleanupErrors = Object.freeze([...cleanupErrors]);
	}
}

export function fileAssetUrl(path: string): string {
	return pathToFileURL(path).toString();
}

async function loadBoundSandbox(options: NodeSandboxOptions): Promise<BoundSandbox> {
	if (options.playground) return options.playground.load(options.language);
	if (!options.loadSandbox) {
		throw new Error('Either playground or loadSandbox must be provided.');
	}
	const binding = createPlaygroundBinding(options.runtimeAssets || '', options.loadSandbox);
	return binding.load(options.language);
}

async function disposeBoundSandbox(sandbox: BoundSandbox): Promise<void> {
	if (sandbox.dispose) await sandbox.dispose();
	else await sandbox.terminate();
}

async function cleanupBoundSandbox(
	sandbox: BoundSandbox,
	clear: boolean,
	dispose: boolean
): Promise<readonly unknown[]> {
	const errors: unknown[] = [];
	if (clear) {
		try {
			await sandbox.clear();
		} catch (error) {
			errors.push(error);
		}
	}
	if (dispose) {
		try {
			await disposeBoundSandbox(sandbox);
		} catch (error) {
			errors.push(error);
		}
	}
	return Object.freeze(errors);
}

function reportNodeError(error: unknown, stderr: (chunk: string) => void): string {
	const message = error instanceof Error ? error.message : String(error);
	try {
		stderr(`${message}\n`);
	} catch {
		// A reporting callback must not replace the runtime failure or prevent cleanup.
	}
	return message;
}

export async function runWasmIdleInNode(options: NodeRunOptions): Promise<NodeRunResult> {
	const sandbox = await loadBoundSandbox(options);
	const stdout = options.stdout || ((chunk: string) => process.stdout.write(chunk));
	const stderr = options.stderr || ((chunk: string) => process.stderr.write(chunk));
	sandbox.output = stdout;
	let outcome: NodeRunResult;
	let cleanupErrors: readonly unknown[];
	try {
		await sandbox.load(
			options.code,
			options.log ?? false,
			options.args || [],
			options.executionOptions || {},
			options.progress
		);
		if (options.stdin !== undefined) {
			sandbox.write?.(options.stdin);
			sandbox.eof?.();
		}
		const result = await sandbox.run(
			options.code,
			false,
			options.log ?? false,
			options.progress,
			options.args || [],
			options.executionOptions || {}
		);
		outcome = {
			ok: result !== false,
			result,
			elapsedMs: sandbox.elapse || 0
		};
	} catch (error) {
		const message = reportNodeError(error, stderr);
		outcome = {
			ok: false,
			result: message,
			elapsedMs: sandbox.elapse || 0,
			error
		};
	} finally {
		cleanupErrors = await cleanupBoundSandbox(
			sandbox,
			options.clearAfterRun ?? false,
			options.disposeAfterRun ?? true
		);
	}
	return cleanupErrors.length ? { ...outcome, cleanupErrors } : outcome;
}

export async function executeWasmIdleInNode(
	options: NodeExecuteOptions
): Promise<NodeExecutionResult> {
	const sandbox = await loadBoundSandbox(options);
	const stdout = options.stdout || ((chunk: string) => process.stdout.write(chunk));
	const stderr = options.stderr || ((chunk: string) => process.stderr.write(chunk));
	sandbox.output = stdout;
	let result: ExecutionResult | undefined;
	let failure: { error: unknown } | undefined;
	let cleanupErrors: readonly unknown[];
	try {
		if (!sandbox.execute) {
			throw new RuntimeConfigurationError(
				`Runtime ${options.language} does not implement structured execution`,
				{ phase: 'configuration' }
			);
		}
		result = await sandbox.execute(options.request);
	} catch (error) {
		failure = { error };
		reportNodeError(error, stderr);
	} finally {
		cleanupErrors = await cleanupBoundSandbox(sandbox, false, options.disposeAfterRun ?? true);
	}
	if (failure) {
		if (cleanupErrors.length) throw new NodeExecutionCleanupError(failure.error, cleanupErrors);
		throw failure.error;
	}
	return cleanupErrors.length ? { ...result!, cleanupErrors } : result!;
}

export type {
	BoundSandbox,
	ExecutionRequest,
	ExecutionResult,
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets
} from '@wasm-idle/core';
