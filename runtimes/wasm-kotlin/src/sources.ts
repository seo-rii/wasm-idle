/** Request-local source data. Offsets and columns count UTF-16 code units. */
export interface KotlinSourceFile {
	readonly path: string;
	readonly text: string;
}

export interface KotlinSourceLimits {
	readonly maxFiles: number;
	readonly maxFileBytes: number;
	readonly maxTotalBytes: number;
	readonly maxPathBytes: number;
}

export const KOTLIN_SOURCE_LIMITS: Readonly<KotlinSourceLimits> = Object.freeze({
	maxFiles: 256,
	maxFileBytes: 2 * 1024 * 1024,
	maxTotalBytes: 8 * 1024 * 1024,
	maxPathBytes: 1024
});

/** Validate already-relative POSIX paths; preserve source text and input order. */
export function prepareKotlinSources(
	input: unknown,
	limits: KotlinSourceLimits = KOTLIN_SOURCE_LIMITS
): readonly KotlinSourceFile[] {
	for (const key of ['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxPathBytes'] as const) {
		const value = limits[key];
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error('Kotlin source limits must be positive safe integers');
		}
	}
	if (!Array.isArray(input) || input.length === 0 || input.length > limits.maxFiles) {
		throw new Error('Kotlin source file count is outside the allowed range');
	}
	const paths = new Set<string>();
	const parents = new Set<string>();
	const encoder = new TextEncoder();
	let totalBytes = 0;
	const files: KotlinSourceFile[] = [];
	for (const file of input) {
		if (!file || typeof file !== 'object' || Array.isArray(file)) {
			throw new Error('Kotlin source file must be an object');
		}
		const { path, text } = file as Record<string, unknown>;
		if (
			typeof path !== 'string' ||
			path.length > limits.maxPathBytes ||
			!path.endsWith('.kt') ||
			/[\\:\u0000-\u001f\u007f]/u.test(path) ||
			path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
			encoder.encode(path).byteLength > limits.maxPathBytes
		) {
			throw new Error('Kotlin source path must be a relative POSIX .kt path');
		}
		if (paths.has(path) || parents.has(path)) {
			throw new Error('Duplicate or conflicting Kotlin source path');
		}
		let slash = path.indexOf('/');
		while (slash !== -1) {
			const parent = path.slice(0, slash);
			if (paths.has(parent)) throw new Error('Conflicting Kotlin source path');
			parents.add(parent);
			slash = path.indexOf('/', slash + 1);
		}
		paths.add(path);
		if (typeof text !== 'string') throw new Error('Kotlin source text must be a string');
		if (text.length > limits.maxFileBytes || text.length > limits.maxTotalBytes - totalBytes) {
			throw new Error('Kotlin source byte limit exceeded');
		}
		// Count transfer bytes without changing the compiler's original UTF-16 text.
		const bytes = encoder.encode(text).byteLength;
		if (bytes > limits.maxFileBytes || bytes > limits.maxTotalBytes - totalBytes) {
			throw new Error('Kotlin source byte limit exceeded');
		}
		totalBytes += bytes;
		files.push(Object.freeze({ path, text }));
	}
	return Object.freeze(files);
}

/** CRLF is one line break; BOM, surrogate pairs, and original text remain intact. */
export function createKotlinLineMap(text: string) {
	const starts = [0];
	for (let offset = 0; offset < text.length; offset++) {
		const code = text.charCodeAt(offset);
		if (code === 13) {
			if (text.charCodeAt(offset + 1) === 10) offset++;
			starts.push(offset + 1);
		} else if (code === 10) {
			starts.push(offset + 1);
		}
	}
	return Object.freeze({
		position(offsetUtf16: number) {
			if (
				!Number.isSafeInteger(offsetUtf16) ||
				offsetUtf16 < 0 ||
				offsetUtf16 > text.length
			) {
				throw new Error('Kotlin diagnostic offset is outside its source');
			}
			let low = 0;
			let high = starts.length;
			while (low + 1 < high) {
				const middle = Math.floor((low + high) / 2);
				if (starts[middle]! <= offsetUtf16) low = middle;
				else high = middle;
			}
			return { line: low + 1, column: offsetUtf16 - starts[low]! + 1 };
		}
	});
}
