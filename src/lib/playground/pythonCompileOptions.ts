import {
	RuntimeConfigurationError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';
import type { SandboxProgress, SandboxRuntimeAssets } from './sandbox';

export interface PythonCompileOptions {
	/** Relative source path used in tracebacks. Defaults to main.py. */
	fileName?: string;
	/** 0 preserves assertions and docstrings; 1 removes assertions; 2 also removes docstrings. */
	optimize?: 0 | 1 | 2;
	/** Cache invalidation format. Defaults to reproducible checked-hash bytecode without a timestamp. */
	invalidationMode?: 'checked-hash' | 'unchecked-hash' | 'timestamp';
	/** Source mtime in integer Unix seconds (0–4294967295). Only valid in timestamp mode; defaults to 0. */
	timestamp?: number;
	runtimeAssets?: SandboxRuntimeAssets;
	persistentCache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
	progress?: SandboxProgress;
	/** maxWorkspaceBytes bounds the source; maxOutputBytes bounds the returned .pyc. */
	limits?: Partial<
		Pick<
			ExecutionLimits,
			| 'assetTimeoutMs'
			| 'startupTimeoutMs'
			| 'compileTimeoutMs'
			| 'maxWorkspaceBytes'
			| 'maxOutputBytes'
			| 'maxAssetBytes'
		>
	>;
}

export interface PythonCompileResult {
	/** Relative output path, e.g. pkg/main.pyc. */
	path: string;
	data: Uint8Array;
	pythonVersion: string;
	cacheTag: string;
	/** Four-byte CPython magic number encoded as eight hexadecimal digits. */
	magicNumber: string;
}

/** Share header-option validation between the host and the actual compiler boundary. */
export function resolvePythonBytecodeOptions(
	options: Pick<PythonCompileOptions, 'invalidationMode' | 'timestamp'>
) {
	const invalidationMode =
		options.invalidationMode === undefined ? 'checked-hash' : options.invalidationMode;
	if (!['checked-hash', 'unchecked-hash', 'timestamp'].includes(invalidationMode)) {
		throw new RuntimeConfigurationError(
			'Python invalidationMode must be checked-hash, unchecked-hash, or timestamp'
		);
	}
	if (invalidationMode !== 'timestamp') {
		if (options.timestamp !== undefined) {
			throw new RuntimeConfigurationError(
				'Python timestamp requires timestamp invalidation mode'
			);
		}
		return { invalidationMode, timestamp: undefined };
	}
	const timestamp = options.timestamp === undefined ? 0 : options.timestamp;
	if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) {
		throw new RuntimeConfigurationError(
			'Python timestamp must be an integer Unix time from 0 to 4294967295 seconds'
		);
	}
	return { invalidationMode, timestamp };
}

/** Validate before starting a runtime, and again at the direct adapter boundary. */
export function resolvePythonCompileRequest(code: string, options: PythonCompileOptions) {
	if (typeof code !== 'string') {
		throw new RuntimeConfigurationError('Python source must be a string');
	}
	const limits = resolveExecutionLimits(options.limits);
	const optimize = options.optimize ?? 0;
	if (![0, 1, 2].includes(optimize)) {
		throw new RuntimeConfigurationError('Python optimize must be 0, 1, or 2');
	}
	const bytecodeOptions = resolvePythonBytecodeOptions(options);
	const workspace = validateExecutionWorkspace(code, [], options.fileName ?? 'main.py', {
		maxFileBytes: limits.maxWorkspaceBytes,
		maxTotalBytes: limits.maxWorkspaceBytes
	});
	const fileName = workspace.activePath!;
	if (!/\.py$/i.test(fileName)) {
		throw new RuntimeConfigurationError('Python compilation requires a .py file name');
	}
	return { fileName, optimize, limits, ...bytecodeOptions };
}
