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
	const workspace = validateExecutionWorkspace(code, [], options.fileName ?? 'main.py', {
		maxFileBytes: limits.maxWorkspaceBytes,
		maxTotalBytes: limits.maxWorkspaceBytes
	});
	const fileName = workspace.activePath!;
	if (!/\.py$/i.test(fileName)) {
		throw new RuntimeConfigurationError('Python compilation requires a .py file name');
	}
	return { fileName, optimize, limits };
}
