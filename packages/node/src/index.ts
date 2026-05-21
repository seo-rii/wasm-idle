import {
	createPlaygroundBinding,
	type BoundSandbox,
	type PlaygroundBinding,
	type SandboxExecutionOptions,
	type SandboxLoader,
	type SandboxProgress,
	type SandboxRuntimeAssets
} from '@wasm-idle/core';
import { pathToFileURL } from 'node:url';

export interface NodeRunOptions {
	language: string;
	code: string;
	runtimeAssets?: SandboxRuntimeAssets;
	loadSandbox?: SandboxLoader;
	playground?: PlaygroundBinding;
	log?: boolean;
	args?: string[];
	executionOptions?: SandboxExecutionOptions;
	progress?: SandboxProgress;
	stdin?: string;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	clearAfterRun?: boolean;
}

export interface NodeRunResult {
	ok: boolean;
	result: boolean | string;
	elapsedMs: number;
}

export function fileAssetUrl(path: string): string {
	return pathToFileURL(path).toString();
}

async function loadBoundSandbox(options: NodeRunOptions): Promise<BoundSandbox> {
	if (options.playground) return options.playground.load(options.language);
	if (!options.loadSandbox) {
		throw new Error('Either playground or loadSandbox must be provided.');
	}
	const binding = createPlaygroundBinding(options.runtimeAssets || '', options.loadSandbox);
	return binding.load(options.language);
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
			ok: result === true,
			result,
			elapsedMs: sandbox.elapse || 0
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`${message}\n`);
		return {
			ok: false,
			result: message,
			elapsedMs: sandbox.elapse || 0
		};
	} finally {
		if (options.clearAfterRun) await sandbox.clear();
	}
}

export type {
	BoundSandbox,
	PlaygroundBinding,
	SandboxLoader,
	SandboxRuntimeAssets
} from '@wasm-idle/core';
