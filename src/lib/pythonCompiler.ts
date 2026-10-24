import { TimeoutError } from '@wasm-idle/core';
import type { PythonCompileOptions, PythonCompileResult } from './playground/pythonCompileOptions';
import { resolvePythonCompileRequest } from './playground/pythonCompileOptions';

export type { PythonCompileOptions, PythonCompileResult } from './playground/pythonCompileOptions';

/**
 * Compile one source file without executing it or loading its imports.
 * A dedicated worker keeps compilation independent of active playground sessions.
 * Its runtime, temporary files, and proxies are disposed on every exit path.
 */
export async function compilePython(
	code: string,
	options: PythonCompileOptions = {}
): Promise<PythonCompileResult> {
	const request = { ...options, ...resolvePythonCompileRequest(code, options) };
	request.signal?.throwIfAborted();
	const importStartedAt = performance.now();
	const { startupTimeoutMs } = request.limits;
	const startupTimeout = new TimeoutError(
		`Python runtime startup timed out after ${startupTimeoutMs} ms`,
		{ runtimeId: 'PYTHON3', phase: 'startup', timeoutMs: startupTimeoutMs }
	);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	// Native imports cannot be cancelled, but callers must not wait for a stalled chunk.
	// The race also handles late import failures without creating a compiler afterward.
	const { default: Python } = await Promise.race([
		import('./playground/python'),
		new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => reject(startupTimeout), startupTimeoutMs);
			onAbort = () => reject(request.signal?.reason);
			request.signal?.addEventListener('abort', onAbort, { once: true });
			if (request.signal?.aborted) onAbort();
		})
	]).finally(() => {
		if (timeout !== undefined) clearTimeout(timeout);
		if (onAbort) request.signal?.removeEventListener('abort', onAbort);
	});
	request.signal?.throwIfAborted();
	const remainingStartupMs = Math.ceil(startupTimeoutMs - (performance.now() - importStartedAt));
	if (remainingStartupMs <= 0) throw startupTimeout;
	const compiler = new Python();
	try {
		await compiler.load(
			request.runtimeAssets,
			'',
			false,
			[],
			{ ...request, limits: { ...request.limits, startupTimeoutMs: remainingStartupMs } },
			request.progress
		);
		return await compiler.compile(code, request);
	} catch (error) {
		if (request.signal?.aborted && error === request.signal.reason) throw error;
		if (typeof error === 'string') throw new Error(error);
		throw error;
	} finally {
		await compiler.dispose();
	}
}
