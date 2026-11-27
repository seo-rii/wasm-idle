export function runtimeAbortReason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');
}

/** Stop waiting for asynchronous asset work and discard late completions after cancellation. */
export function waitForRuntimeAssetOperation<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
	onLateValue?: (value: T, reason: unknown) => void | Promise<void>
): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const cancelOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', cancelOnAbort);
			reject(runtimeAbortReason(signal));
		};
		signal.addEventListener('abort', cancelOnAbort, { once: true });
		operation.then(
			(value) => {
				if (settled) {
					if (onLateValue) {
						void Promise.resolve()
							.then(() => onLateValue(value, signal.reason))
							.catch(() => {});
					}
					return;
				}
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				reject(error);
			}
		);
		if (signal.aborted) cancelOnAbort();
	});
}
