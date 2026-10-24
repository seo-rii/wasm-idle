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
	const { default: Python } = await import('./playground/python');
	request.signal?.throwIfAborted();
	const compiler = new Python();
	try {
		await compiler.load(request.runtimeAssets, '', false, [], request, request.progress);
		return await compiler.compile(code, request);
	} catch (error) {
		if (request.signal?.aborted && error === request.signal.reason) throw error;
		if (typeof error === 'string') throw new Error(error);
		throw error;
	} finally {
		await compiler.dispose();
	}
}
