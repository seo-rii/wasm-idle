import {
	CLANG_CPP_HEADER_ANCHOR,
	CLANG_CPP_HEADERS,
	CLANG_CPP_HEADER_PROVENANCE
} from './clang-cpp-headers.generated.js';

interface CppHeaderFileSystem {
	readFile(path: string): Uint8Array | null;
	mkdirTree(path: string): void;
	writeFile(path: string, contents: Uint8Array): void;
}

/** Restore standard-dependent headers omitted by the pinned producer's C++20 pruning. */
export async function installClangCppHeaders(
	fs: CppHeaderFileSystem,
	provenance?: { name: string; version: string; revision: string }
) {
	if (
		provenance?.name !== CLANG_CPP_HEADER_PROVENANCE.name ||
		provenance.version !== CLANG_CPP_HEADER_PROVENANCE.version ||
		provenance.revision !== CLANG_CPP_HEADER_PROVENANCE.revision
	)
		return false;

	const prefix = '/include/c++/v1/';
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const anchor = fs.readFile(`${prefix}${CLANG_CPP_HEADER_ANCHOR.path}`);
	// The C-only profile and custom standard libraries must retain their own headers.
	if (anchor === null || anchor.byteLength !== CLANG_CPP_HEADER_ANCHOR.bytes) return false;
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', Uint8Array.from(anchor).buffer)
	);
	const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
	if (sha256 !== CLANG_CPP_HEADER_ANCHOR.sha256) return false;

	const missing: Array<[string, string]> = [];
	for (const [name, contents] of Object.entries(CLANG_CPP_HEADERS)) {
		const path = `${prefix}${name}`;
		const existing = fs.readFile(path);
		if (existing === null) {
			missing.push([path, contents]);
		} else if (decoder.decode(existing) !== contents) {
			throw new Error(
				`Clang ${provenance.version} C++ header differs from its pinned source: ${name}`
			);
		}
	}
	// Check every existing file before making any changes to the mounted sysroot.
	const encoder = new TextEncoder();
	for (const [path, contents] of missing) {
		fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
		fs.writeFile(path, encoder.encode(contents));
	}
	return true;
}
