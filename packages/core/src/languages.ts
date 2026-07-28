export type WasmIdleLanguageId =
	| 'PYTHON3'
	| 'PYTHON'
	| 'PYPY3'
	| 'C'
	| 'CPP'
	| 'OBJC'
	| 'OBJECTIVEC'
	| 'OBJECTIVE_C'
	| 'OBJECTIVE-C'
	| 'JAVA'
	| 'RUST'
	| 'GO'
	| 'D'
	| 'DLANG'
	| 'CSHARP'
	| 'C#'
	| 'FSHARP'
	| 'F#'
	| 'VBNET'
	| 'VB'
	| 'VISUALBASIC'
	| 'ELIXIR'
	| 'ERLANG'
	| 'ERL'
	| 'PROLOG'
	| 'SWIPL'
	| 'SWI'
	| 'GLEAM'
	| 'PERL'
	| 'TCL'
	| 'TCLSH'
	| 'AWK'
	| 'GAWK'
	| 'PASCAL'
	| 'PAS'
	| 'FPC'
	| 'FORTH'
	| 'GFORTH'
	| 'J'
	| 'BQN'
	| 'JANET'
	| 'JULIA'
	| 'JL'
	| 'NIM'
	| 'NIMROD'
	| 'BASH'
	| 'SH'
	| 'SHELL'
	| 'CLOJURESCRIPT'
	| 'CLJS'
	| 'FORTRAN'
	| 'F77'
	| 'COBOL'
	| 'COB'
	| 'CBL'
	| 'GNUCOBOL'
	| 'TINYGO'
	| 'OCAML'
	| 'JAVASCRIPT'
	| 'JS'
	| 'TYPESCRIPT'
	| 'TS'
	| 'ASSEMBLYSCRIPT'
	| 'AS'
	| 'WAT'
	| 'WASM'
	| 'WASM32'
	| 'LUA'
	| 'ZIG'
	| 'LISP'
	| 'SCHEME'
	| 'SCM'
	| 'RUBY'
	| 'RB'
	| 'HASKELL'
	| 'HS'
	| 'R'
	| 'OCTAVE'
	| 'MATLAB'
	| 'DUCKDB'
	| 'SQLITE'
	| 'SQL'
	| 'PHP';

export const supportedLanguageIds = [
	'PYTHON3',
	'C',
	'CPP',
	'OBJC',
	'JAVA',
	'RUST',
	'GO',
	'D',
	'CSHARP',
	'FSHARP',
	'VBNET',
	'ELIXIR',
	'ERLANG',
	'PROLOG',
	'GLEAM',
	'PERL',
	'TCL',
	'AWK',
	'PASCAL',
	'FORTH',
	'J',
	'BQN',
	'JANET',
	'JULIA',
	'NIM',
	'BASH',
	'CLOJURESCRIPT',
	'FORTRAN',
	'COBOL',
	'TINYGO',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'ASSEMBLYSCRIPT',
	'WAT',
	'WASM',
	'LUA',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'OCTAVE',
	'DUCKDB',
	'SQLITE',
	'PHP'
] as const;

export type CanonicalLanguageId = (typeof supportedLanguageIds)[number];

export type LanguageAliasKind = 'spelling' | 'compatibility' | 'dialect' | 'implementation';

export interface LanguageAliasInfo {
	alias: string;
	canonicalId: CanonicalLanguageId;
	kind: LanguageAliasKind;
	deprecated: boolean;
	message?: string;
}

export const DEFAULT_DEFERRED_PROGRESS_LANGUAGES = new Set<string>([
	'OBJC',
	'RUST',
	'GO',
	'D',
	'CSHARP',
	'FSHARP',
	'VBNET',
	'TINYGO',
	'ERLANG',
	'PROLOG',
	'GLEAM',
	'PERL',
	'TCL',
	'AWK',
	'PASCAL',
	'FORTH',
	'J',
	'BQN',
	'JANET',
	'JULIA',
	'NIM',
	'BASH',
	'CLOJURESCRIPT',
	'FORTRAN',
	'COBOL',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'ASSEMBLYSCRIPT',
	'WAT',
	'WASM',
	'LUA',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'OCTAVE',
	'DUCKDB',
	'SQLITE',
	'PHP'
]);

const languageAliasDefinitions = {
	'C#': { canonicalId: 'CSHARP', kind: 'spelling' },
	'F#': { canonicalId: 'FSHARP', kind: 'spelling' },
	VB: { canonicalId: 'VBNET', kind: 'spelling' },
	VISUALBASIC: { canonicalId: 'VBNET', kind: 'spelling' },
	OBJECTIVEC: { canonicalId: 'OBJC', kind: 'spelling' },
	OBJECTIVE_C: { canonicalId: 'OBJC', kind: 'spelling' },
	'OBJECTIVE-C': { canonicalId: 'OBJC', kind: 'spelling' },
	ERL: { canonicalId: 'ERLANG', kind: 'spelling' },
	SWIPL: { canonicalId: 'PROLOG', kind: 'implementation' },
	SWI: { canonicalId: 'PROLOG', kind: 'implementation' },
	TCLSH: { canonicalId: 'TCL', kind: 'implementation' },
	GAWK: { canonicalId: 'AWK', kind: 'implementation' },
	PAS: { canonicalId: 'PASCAL', kind: 'spelling' },
	FPC: { canonicalId: 'PASCAL', kind: 'implementation' },
	GFORTH: { canonicalId: 'FORTH', kind: 'implementation' },
	JL: { canonicalId: 'JULIA', kind: 'spelling' },
	NIMROD: { canonicalId: 'NIM', kind: 'spelling' },
	SH: { canonicalId: 'BASH', kind: 'compatibility' },
	SHELL: { canonicalId: 'BASH', kind: 'compatibility' },
	CLJS: { canonicalId: 'CLOJURESCRIPT', kind: 'spelling' },
	F77: { canonicalId: 'FORTRAN', kind: 'dialect' },
	COB: { canonicalId: 'COBOL', kind: 'spelling' },
	CBL: { canonicalId: 'COBOL', kind: 'spelling' },
	GNUCOBOL: { canonicalId: 'COBOL', kind: 'implementation' },
	DLANG: { canonicalId: 'D', kind: 'spelling' },
	JS: { canonicalId: 'JAVASCRIPT', kind: 'spelling' },
	AS: { canonicalId: 'ASSEMBLYSCRIPT', kind: 'spelling' },
	PYTHON: { canonicalId: 'PYTHON3', kind: 'spelling' },
	PYPY3: {
		canonicalId: 'PYTHON3',
		kind: 'implementation',
		deprecated: true,
		message: 'PYPY3 runs the Pyodide implementation; use PYTHON3 instead.'
	},
	HS: { canonicalId: 'HASKELL', kind: 'spelling' },
	RB: { canonicalId: 'RUBY', kind: 'spelling' },
	SCHEME: {
		canonicalId: 'LISP',
		kind: 'compatibility',
		message: 'SCHEME selects the bundled Puppy Scheme-compatible runtime.'
	},
	SCM: {
		canonicalId: 'LISP',
		kind: 'compatibility',
		message: 'SCM selects the bundled Puppy Scheme-compatible runtime.'
	},
	TS: { canonicalId: 'TYPESCRIPT', kind: 'spelling' },
	MATLAB: {
		canonicalId: 'OCTAVE',
		kind: 'compatibility',
		message: 'MATLAB selects GNU Octave compatibility, not MATLAB.'
	},
	SQL: {
		canonicalId: 'SQLITE',
		kind: 'dialect',
		message: 'SQL selects the SQLite dialect and engine.'
	},
	WASM32: { canonicalId: 'WASM', kind: 'spelling' }
} as const satisfies Record<
	string,
	{
		canonicalId: CanonicalLanguageId;
		kind: LanguageAliasKind;
		deprecated?: boolean;
		message?: string;
	}
>;

export const languageAliases: Readonly<Record<string, LanguageAliasInfo>> = Object.freeze(
	Object.fromEntries(
		Object.entries(languageAliasDefinitions).map(([alias, definition]) => [
			alias,
			Object.freeze({ alias, deprecated: false, ...definition })
		])
	)
);

export function getLanguageAliasInfo(language: string): LanguageAliasInfo | undefined {
	return languageAliases[language.trim().toUpperCase()];
}

export function normalizeLanguageId(language: string): string {
	const upper = language.trim().toUpperCase();
	return languageAliases[upper]?.canonicalId ?? upper;
}

export function isDeferredProgressLanguage(language: string): boolean {
	return DEFAULT_DEFERRED_PROGRESS_LANGUAGES.has(normalizeLanguageId(language));
}
