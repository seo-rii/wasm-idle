export type WasmIdleLanguageId =
	| 'PYTHON3'
	| 'PYTHON'
	| 'PYPY3'
	| 'C'
	| 'CPP'
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
	'PYPY3',
	'C',
	'CPP',
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

export const DEFAULT_DEFERRED_PROGRESS_LANGUAGES = new Set<string>([
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

const LANGUAGE_ALIASES: Record<string, string> = {
	'C#': 'CSHARP',
	'F#': 'FSHARP',
	VB: 'VBNET',
	VISUALBASIC: 'VBNET',
	ERL: 'ERLANG',
	SWIPL: 'PROLOG',
	SWI: 'PROLOG',
	TCLSH: 'TCL',
	GAWK: 'AWK',
	PAS: 'PASCAL',
	FPC: 'PASCAL',
	GFORTH: 'FORTH',
	JL: 'JULIA',
	NIMROD: 'NIM',
	DLANG: 'D',
	JS: 'JAVASCRIPT',
	AS: 'ASSEMBLYSCRIPT',
	PYTHON: 'PYTHON3',
	HS: 'HASKELL',
	RB: 'RUBY',
	SCHEME: 'LISP',
	SCM: 'LISP',
	TS: 'TYPESCRIPT',
	MATLAB: 'OCTAVE',
	SQL: 'SQLITE',
	WASM32: 'WASM'
};

export function normalizeLanguageId(language: string): string {
	const upper = language.trim().toUpperCase();
	return LANGUAGE_ALIASES[upper] || upper;
}

export function isDeferredProgressLanguage(language: string): boolean {
	return DEFAULT_DEFERRED_PROGRESS_LANGUAGES.has(normalizeLanguageId(language));
}
