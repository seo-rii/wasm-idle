/** Bound output while synchronous Wasm owns the worker, including newline-free output. */
export function createJavaOutput(
	emit: (text: string) => void,
	options: { maxChars?: number; maxDelayMs?: number; now?: () => number } = {}
) {
	const maxChars = options.maxChars ?? 16384;
	const maxDelayMs = options.maxDelayMs ?? 16;
	const now = options.now ?? (() => performance.now());
	if (
		!Number.isSafeInteger(maxChars) ||
		maxChars < 2 ||
		!Number.isFinite(maxDelayMs) ||
		maxDelayMs < 0
	)
		throw new RangeError('Invalid Java output batch limits');
	let text = '';
	let hasEmitted = false;
	let lastFlush = now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	function flush() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		if (!text) return;
		const output = text;
		text = '';
		hasEmitted = true;
		lastFlush = now();
		emit(output);
	}
	return {
		write(charCode: number) {
			if (closed) return;
			// A high surrogate is held until the next code unit, so output accounting
			// does not encode a valid pair as two replacement characters.
			if (text.length >= maxChars - 1 && !(charCode >= 0xdc00 && charCode <= 0xdfff)) flush();
			text += String.fromCharCode(charCode);
			if (charCode >= 0xd800 && charCode <= 0xdbff) return;
			if (text.length >= maxChars || !hasEmitted || now() - lastFlush >= maxDelayMs) flush();
			else if (timer === undefined) timer = setTimeout(flush, maxDelayMs);
		},
		flush,
		close() {
			flush();
			closed = true;
		}
	};
}
