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

function reportNodeError(error: unknown, stderr: (chunk: string) => void): string {
	const message = error instanceof Error ? error.message : String(error);
	stderr(`${message}\n`);
	return message;
}

export async function runWasmIdleInNode(options: NodeRunOptions): Promise<NodeRunResult> {
	const sandbox = await loadBoundSandbox(options);
	const stdout = options.stdout || ((chunk: string) => process.stdout.write(chunk));
	const stderr = options.stderr || ((chunk: string) => process.stderr.write(chunk));
	sandbox.output = stdout;
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
		return {
			ok: result !== false,
			result,
			elapsedMs: sandbox.elapse || 0
		};
	} catch (error) {
		const message = reportNodeError(error, stderr);
		return {
			ok: false,
			result: message,
			elapsedMs: sandbox.elapse || 0,
			error
		};
	} finally {
		if (options.clearAfterRun) await sandbox.clear();
		if (options.disposeAfterRun ?? true) await disposeBoundSandbox(sandbox);
	}
}

export async function executeWasmIdleInNode(options: NodeExecuteOptions): Promise<ExecutionResult> {
	const sandbox = await loadBoundSandbox(options);
	const stdout = options.stdout || ((chunk: string) => process.stdout.write(chunk));
	const stderr = options.stderr || ((chunk: string) => process.stderr.write(chunk));
	sandbox.output = stdout;
	try {
		if (!sandbox.execute) {
			throw new RuntimeConfigurationError(
				`Runtime ${options.language} does not implement structured execution`,
				{ phase: 'configuration' }
			);
		}
		return await sandbox.execute(options.request);
	} catch (error) {
		reportNodeError(error, stderr);
		throw error;
	} finally {
		if (options.disposeAfterRun ?? true) await disposeBoundSandbox(sandbox);
	}
}

export type {
	BoundSandbox,
	ExecutionRequest,
	ExecutionResult,
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets
} from '@wasm-idle/core';
