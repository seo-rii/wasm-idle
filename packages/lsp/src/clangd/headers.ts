export interface ClangdHeaderAsset {
	schemaVersion: 1;
	version: string;
	targetTriple: string;
	resourceDir: string;
	files: Record<string, string>;
}

/** Validate the whole tree before writing anything into clangd's filesystem. */
function validateClangdHeaders(input: unknown): ClangdHeaderAsset {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new Error('Invalid clangd header asset metadata');
	const value = input as Record<string, unknown>;
	if (
		!value ||
		value.schemaVersion !== 1 ||
		typeof value.version !== 'string' ||
		!value.version ||
		typeof value.targetTriple !== 'string' ||
		!/^wasm32-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.targetTriple) ||
		typeof value.resourceDir !== 'string' ||
		!/^\/lib\/clang\/[a-zA-Z0-9_.-]+$/.test(value.resourceDir) ||
		!value.files ||
		typeof value.files !== 'object' ||
		Array.isArray(value.files)
	)
		throw new Error('Invalid clangd header asset metadata');
	const files = value.files as Record<string, unknown>;
	const roots = ['/usr/include/', `${value.resourceDir}/include/`];
	for (const [path, contents] of Object.entries(files)) {
		if (
			!roots.some((root) => path.startsWith(root)) ||
			path
				.slice(1)
				.split('/')
				.some((part) => !part || part === '.' || part === '..') ||
			/[\\\x00-\x1f]/u.test(path) ||
			typeof contents !== 'string'
		)
			throw new Error('Invalid clangd header path or contents');
	}
	for (const file of [
		`/usr/include/${value.targetTriple}/stdio.h`,
		'/usr/include/c++/v1/vector',
		`${value.resourceDir}/include/stddef.h`
	]) {
		if (!Object.hasOwn(files, file) || typeof files[file] !== 'string')
			throw new Error(`Required clangd asset header is missing: ${file}`);
	}
	return {
		schemaVersion: 1,
		version: value.version,
		targetTriple: value.targetTriple,
		resourceDir: value.resourceDir,
		files: files as Record<string, string>
	};
}

export function parseClangdHeaders(bytes: Uint8Array): ClangdHeaderAsset {
	if (bytes.byteLength > 128 * 1024 * 1024)
		throw new Error('clangd headers exceed the runtime byte limit');
	return validateClangdHeaders(
		JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
	);
}

export function mountClangdHeaders(
	fs: { mkdirTree(path: string): void; writeFile(path: string, contents: string): void },
	headers: ClangdHeaderAsset
) {
	// Revalidate at the worker boundary, even when the host parsed the asset already.
	const verified = validateClangdHeaders(headers);
	for (const [path, contents] of Object.entries(verified.files)) {
		fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
		fs.writeFile(path, contents);
	}
	return verified.resourceDir;
}
