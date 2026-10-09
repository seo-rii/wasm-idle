const canonicalLanguageIds = [
	'C',
	'C3',
	'CPP',
	'OBJC',
	'OBJECTIVECXX',
	'PYTHON3',
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
	'GRAIN',
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
	'RESCRIPT',
	'HY',
	'FORTRAN',
	'LFORTRAN',
	'COBOL',
	'V',
	'TINYGO',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'ASSEMBLYSCRIPT',
	'WAT',
	'WASM',
	'WHITESPACE',
	'MALBOLGE',
	'AHEUI',
	'UHMLANG',
	'BRAINFUCK',
	'BEFUNGE93',
	'LUA',
	'FENNEL',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'OCTAVE',
	'DUCKDB',
	'SQLITE',
	'POSTGRESQL',
	'PHP'
] as const;

export type CanonicalLanguageId = (typeof canonicalLanguageIds)[number];

export const supportedLanguageIds = Object.freeze(canonicalLanguageIds);

export type LanguageAliasKind = 'spelling' | 'compatibility' | 'dialect' | 'implementation';

export interface LanguageAliasInfo {
	alias: string;
	canonicalId: CanonicalLanguageId;
	kind: LanguageAliasKind;
	deprecated: boolean;
	message?: string;
}

const eagerProgressLanguageIds = [
	'C',
	'CPP',
	'PYTHON3',
	'JAVA'
] as const satisfies readonly CanonicalLanguageId[];
const eagerProgressLanguages = new Set<string>(eagerProgressLanguageIds);

export const DEFAULT_DEFERRED_PROGRESS_LANGUAGES: ReadonlySet<string> = new Set(
	supportedLanguageIds.filter((language) => !eagerProgressLanguages.has(language))
);

const languageAliasDefinitions = {
	BEFUNGE: { canonicalId: 'BEFUNGE93', kind: 'dialect' },
	'BEFUNGE-93': { canonicalId: 'BEFUNGE93', kind: 'spelling' },
	BF: { canonicalId: 'BRAINFUCK', kind: 'spelling' },
	'C#': { canonicalId: 'CSHARP', kind: 'spelling' },
	'F#': { canonicalId: 'FSHARP', kind: 'spelling' },
	VB: { canonicalId: 'VBNET', kind: 'spelling' },
	VISUALBASIC: { canonicalId: 'VBNET', kind: 'spelling' },
	OBJECTIVEC: { canonicalId: 'OBJC', kind: 'spelling' },
	OBJECTIVE_C: { canonicalId: 'OBJC', kind: 'spelling' },
	'OBJECTIVE-C': { canonicalId: 'OBJC', kind: 'spelling' },
	OBJCXX: { canonicalId: 'OBJECTIVECXX', kind: 'spelling' },
	OBJCPP: { canonicalId: 'OBJECTIVECXX', kind: 'spelling' },
	OBJECTIVE_CXX: { canonicalId: 'OBJECTIVECXX', kind: 'spelling' },
	'OBJECTIVE-C++': { canonicalId: 'OBJECTIVECXX', kind: 'spelling' },
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
	RES: { canonicalId: 'RESCRIPT', kind: 'spelling' },
	HYLANG: { canonicalId: 'HY', kind: 'spelling' },
	F77: { canonicalId: 'FORTRAN', kind: 'dialect' },
	COB: { canonicalId: 'COBOL', kind: 'spelling' },
	CBL: { canonicalId: 'COBOL', kind: 'spelling' },
	GNUCOBOL: { canonicalId: 'COBOL', kind: 'implementation' },
	VLANG: { canonicalId: 'V', kind: 'spelling' },
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
	FNL: { canonicalId: 'FENNEL', kind: 'spelling' },
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
	POSTGRES: { canonicalId: 'POSTGRESQL', kind: 'spelling' },
	PGSQL: { canonicalId: 'POSTGRESQL', kind: 'spelling' },
	PGLITE: {
		canonicalId: 'POSTGRESQL',
		kind: 'implementation',
		message: 'PGLITE selects PostgreSQL running through the PGlite WebAssembly build.'
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

export type LanguageAliasId = keyof typeof languageAliasDefinitions;
export type WasmIdleLanguageId = CanonicalLanguageId | LanguageAliasId;

export const languageAliasIds = Object.freeze(
	Object.keys(languageAliasDefinitions) as LanguageAliasId[]
);

export const languageAliases = Object.freeze(
	Object.fromEntries(
		Object.entries(languageAliasDefinitions).map(([alias, definition]) => [
			alias,
			Object.freeze({ alias, deprecated: false, ...definition })
		])
	) as Record<LanguageAliasId, LanguageAliasInfo>
);

export function getLanguageAliasInfo(language: string): LanguageAliasInfo | undefined {
	return languageAliases[language.trim().toUpperCase() as LanguageAliasId];
}

export function normalizeLanguageId(language: WasmIdleLanguageId): CanonicalLanguageId;
export function normalizeLanguageId(language: string): string;
export function normalizeLanguageId(language: string): string {
	const upper = language.trim().toUpperCase();
	return languageAliases[upper as LanguageAliasId]?.canonicalId ?? upper;
}

export function isSupportedLanguageId(language: string): language is CanonicalLanguageId {
	return (supportedLanguageIds as readonly string[]).includes(language);
}

export function isDeferredProgressLanguage(language: string): boolean {
	return DEFAULT_DEFERRED_PROGRESS_LANGUAGES.has(normalizeLanguageId(language));
}
