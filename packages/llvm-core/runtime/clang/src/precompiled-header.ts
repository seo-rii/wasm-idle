/**
 * A precompiled `<bits/stdc++.h>` stands in for the textual include only when the include is the
 * first thing in the translation unit; earlier macros or pragmas could change what it declares.
 */
export const STDCPP_HEADER_PATH = '/include/bits/stdc++.h';
export const PRECOMPILED_HEADER_PATH = '__wasm_idle_build/pch/stdc++.pch';

/** Arguments that cannot redirect header lookup. The header is built with the same arguments. */
const eligibleArgumentPatterns = [
	/^-[DU][A-Za-z_]/,
	/^-W/,
	/^-w$/,
	/^-f[a-z]/,
	/^-O([0-3sz]|fast)?$/,
	/^-std=/,
	/^-pedantic(-errors)?$/
];

/** Clang rejects an incompatible precompiled header with one of these diagnostics. */
export const precompiledHeaderErrorPattern = /precompiled (header|file)|PCH file|AST file/i;

export interface BrowserClangPrecompiledHeader {
	key: string;
	bytes: Uint8Array;
}

export function startsWithStdcppInclude(source: string) {
	let rest = source.replace(/^\uFEFF/, '');
	for (;;) {
		rest = rest.replace(/^\s+/, '');
		if (rest.startsWith('//')) {
			const end = rest.indexOf('\n');
			// A trailing backslash continues the comment onto the include line.
			if (end < 0 || rest.slice(0, end).trimEnd().endsWith('\\')) return false;
			rest = rest.slice(end + 1);
		} else if (rest.startsWith('/*')) {
			const end = rest.indexOf('*/', 2);
			if (end < 0) return false;
			rest = rest.slice(end + 2);
		} else break;
	}
	return /^#[ \t]*include[ \t]*<bits\/stdc\+\+\.h>/.test(rest);
}

export function precompiledHeaderArgsEligible(args: readonly unknown[]) {
	return args.every(
		(arg) =>
			typeof arg === 'string' &&
			arg !== '-fsyntax-only' &&
			eligibleArgumentPatterns.some((pattern) => pattern.test(arg))
	);
}
