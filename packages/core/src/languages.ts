export type WasmIdleLanguageId =
	| 'PYTHON3'
	| 'PYTHON'
	| 'PYPY3'
	| 'C'
	| 'CPP'
	| 'JAVA'
	| 'RUST'
	| 'GO'
	| 'CSHARP'
	| 'C#'
	| 'FSHARP'
	| 'F#'
	| 'ELIXIR'
	| 'TINYGO'
	| 'OCAML'
	| 'JAVASCRIPT'
	| 'JS'
	| 'TYPESCRIPT'
	| 'TS'
	| 'ASSEMBLYSCRIPT'
	| 'AS'
	| 'WAT'
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
	'CSHARP',
	'FSHARP',
	'ELIXIR',
	'TINYGO',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'ASSEMBLYSCRIPT',
	'WAT',
	'LUA',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'SQLITE',
	'PHP'
] as const;

export const DEFAULT_DEFERRED_PROGRESS_LANGUAGES = new Set<string>([
	'RUST',
	'GO',
	'CSHARP',
	'FSHARP',
	'TINYGO',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'ASSEMBLYSCRIPT',
	'WAT',
	'LUA',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'SQLITE',
	'PHP'
]);

const LANGUAGE_ALIASES: Record<string, string> = {
	'C#': 'CSHARP',
	'F#': 'FSHARP',
	JS: 'JAVASCRIPT',
	AS: 'ASSEMBLYSCRIPT',
	PYTHON: 'PYTHON3',
	HS: 'HASKELL',
	RB: 'RUBY',
	SCHEME: 'LISP',
	SCM: 'LISP',
	TS: 'TYPESCRIPT',
	SQL: 'SQLITE'
};

export function normalizeLanguageId(language: string): string {
	const upper = language.trim().toUpperCase();
	return LANGUAGE_ALIASES[upper] || upper;
}

export function isDeferredProgressLanguage(language: string): boolean {
	return DEFAULT_DEFERRED_PROGRESS_LANGUAGES.has(normalizeLanguageId(language));
}
