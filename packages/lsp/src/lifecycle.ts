export interface SignalTimeoutOptions {
	signal?: AbortSignal;
	timeoutMs: number;
	operationName: string;
	timeoutError: () => Error;
}

export async function runWithSignalAndTimeout<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	options: SignalTimeoutOptions
): Promise<T> {
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new TypeError(`${options.operationName} timeout must be a positive safe integer`);
	}
	if (options.signal?.aborted) {
		throw options.signal.reason instanceof Error
			? options.signal.reason
			: new DOMException(`${options.operationName} was cancelled`, 'AbortError');
	}

	const controller = new AbortController();
	let rejectStopped = (_reason: unknown) => {};
	const stopped = new Promise<never>((_resolve, reject) => {
		rejectStopped = reject;
	});
	const stop = (reason: Error) => {
		if (controller.signal.aborted) return;
		controller.abort(reason);
		rejectStopped(reason);
	};
	const handleAbort = () => {
		stop(
			options.signal?.reason instanceof Error
				? options.signal.reason
				: new DOMException(`${options.operationName} was cancelled`, 'AbortError')
		);
	};
	options.signal?.addEventListener('abort', handleAbort, { once: true });
	const timeout = setTimeout(() => {
		stop(options.timeoutError());
	}, options.timeoutMs);

	try {
		const running = Promise.resolve().then(() => {
			if (controller.signal.aborted) throw controller.signal.reason;
			return operation(controller.signal);
		});
		return await Promise.race([running, stopped]);
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', handleAbort);
	}
}

export const DEFAULT_LANGUAGE_SERVER_STARTUP_TIMEOUT_MS = 120_000;

export class LanguageServerStartupTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Language server startup timed out after ${timeoutMs} ms`);
		this.name = 'LanguageServerStartupTimeoutError';
	}
}

export interface LanguageServerStartupOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export async function waitForLanguageServerStartup(
	start: () => Promise<void>,
	options: LanguageServerStartupOptions = {}
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_LANGUAGE_SERVER_STARTUP_TIMEOUT_MS;
	await runWithSignalAndTimeout((_signal) => start(), {
		signal: options.signal,
		timeoutMs,
		operationName: 'Language server startup',
		timeoutError: () => new LanguageServerStartupTimeoutError(timeoutMs)
	});
}
