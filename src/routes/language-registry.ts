export type PlaygroundLanguage =
	| 'C'
	| 'CPP'
	| 'PYTHON'
	| 'JAVA'
	| 'RUST'
	| 'GO'
	| 'D'
	| 'CSHARP'
	| 'FSHARP'
	| 'VBNET'
	| 'ELIXIR'
	| 'ERLANG'
	| 'PROLOG'
	| 'GLEAM'
	| 'PERL'
	| 'TCL'
	| 'AWK'
	| 'PASCAL'
	| 'FORTH'
	| 'J'
	| 'BQN'
	| 'JANET'
	| 'OCAML'
	| 'TINYGO'
	| 'JAVASCRIPT'
	| 'TYPESCRIPT'
	| 'ASSEMBLYSCRIPT'
	| 'WAT'
	| 'LUA'
	| 'ZIG'
	| 'LISP'
	| 'RUBY'
	| 'HASKELL'
	| 'R'
	| 'OCTAVE'
	| 'FORTRAN'
	| 'GRAPHQL'
	| 'DUCKDB'
	| 'SQLITE'
	| 'PHP';

export type RuntimeLspCapability =
	| 'gleam'
	| 'go'
	| 'rust'
	| 'zig'
	| 'php'
	| 'lua'
	| 'ocaml'
	| 'haskell'
	| 'sql'
	| 'prolog'
	| 'ruby';

export type DotnetLspLanguage = 'csharp' | 'fsharp' | 'vbnet';

type MonacoLanguageContributionLoader = () => Promise<unknown>;

export const playgroundLanguages: PlaygroundLanguage[] = [
	'C',
	'CPP',
	'PYTHON',
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
	'OCAML',
	'TINYGO',
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
	'OCTAVE',
	'FORTRAN',
	'GRAPHQL',
	'DUCKDB',
	'SQLITE',
	'PHP'
];

export const languageLabels: Record<PlaygroundLanguage, string> = {
	C: 'C',
	CPP: 'C++',
	PYTHON: 'Python',
	JAVA: 'Java',
	RUST: 'Rust',
	GO: 'Go',
	D: 'D',
	CSHARP: 'C#',
	FSHARP: 'F#',
	VBNET: 'VB.NET',
	ELIXIR: 'Elixir',
	ERLANG: 'Erlang',
	PROLOG: 'Prolog',
	GLEAM: 'Gleam',
	PERL: 'Perl',
	TCL: 'Tcl',
	AWK: 'AWK',
	PASCAL: 'Pascal',
	FORTH: 'Forth',
	J: 'J',
	BQN: 'BQN',
	JANET: 'Janet',
	OCAML: 'OCaml',
	TINYGO: 'TinyGo',
	JAVASCRIPT: 'JavaScript',
	TYPESCRIPT: 'TypeScript',
	ASSEMBLYSCRIPT: 'AssemblyScript',
	WAT: 'WAT',
	LUA: 'Lua',
	ZIG: 'Zig',
	LISP: 'Scheme',
	RUBY: 'Ruby',
	HASKELL: 'Haskell',
	R: 'R',
	OCTAVE: 'Octave',
	FORTRAN: 'Fortran',
	GRAPHQL: 'GraphQL',
	DUCKDB: 'DuckDB',
	SQLITE: 'SQLite',
	PHP: 'PHP'
};

export const editorLanguages: Record<PlaygroundLanguage, string> = {
	C: 'c',
	CPP: 'cpp',
	PYTHON: 'python',
	JAVA: 'java',
	RUST: 'rust',
	GO: 'go',
	D: 'd',
	CSHARP: 'csharp',
	FSHARP: 'fsharp',
	VBNET: 'vb',
	ELIXIR: 'elixir',
	ERLANG: 'erlang',
	PROLOG: 'prolog',
	GLEAM: 'gleam',
	PERL: 'perl',
	TCL: 'tcl',
	AWK: 'awk',
	PASCAL: 'pascal',
	FORTH: 'forth',
	J: 'j',
	BQN: 'bqn',
	JANET: 'janet',
	OCAML: 'ocaml',
	TINYGO: 'go',
	JAVASCRIPT: 'javascript',
	TYPESCRIPT: 'typescript',
	ASSEMBLYSCRIPT: 'typescript',
	WAT: 'wat',
	LUA: 'lua',
	ZIG: 'zig',
	LISP: 'lisp',
	RUBY: 'ruby',
	HASKELL: 'haskell',
	R: 'r',
	OCTAVE: 'octave',
	FORTRAN: 'fortran',
	GRAPHQL: 'graphql',
	DUCKDB: 'sql',
	SQLITE: 'sql',
	PHP: 'php'
};

export const debugLspLanguages = new Set<PlaygroundLanguage>(['CPP']);
export const clangdLspLanguages = new Set<PlaygroundLanguage>(['C', 'CPP']);
export const dotnetLspLanguages = new Set<PlaygroundLanguage>(['CSHARP', 'FSHARP', 'VBNET']);
export const typescriptLspLanguages = new Set<PlaygroundLanguage>(['JAVASCRIPT', 'TYPESCRIPT']);
export const lspLanguageOverrides: Partial<Record<PlaygroundLanguage, string>> = {
	ASSEMBLYSCRIPT: 'assemblyscript',
	DUCKDB: 'duckdb'
};
export const editorOnlyLanguages = new Set<PlaygroundLanguage>(['FORTRAN', 'GRAPHQL', 'DUCKDB']);
export const runtimeLspCapabilities: Partial<Record<PlaygroundLanguage, RuntimeLspCapability>> = {
	GLEAM: 'gleam',
	GO: 'go',
	RUST: 'rust',
	ZIG: 'zig',
	PHP: 'php',
	LUA: 'lua',
	OCAML: 'ocaml',
	HASKELL: 'haskell',
	SQLITE: 'sql',
	PROLOG: 'prolog',
	RUBY: 'ruby'
};
export const argsHelpLanguages = new Set<PlaygroundLanguage>([
	'JAVA',
	'RUST',
	'GO',
	'D',
	'CSHARP',
	'FSHARP',
	'VBNET',
	'PROLOG',
	'GLEAM',
	'PERL',
	'TCL',
	'AWK',
	'TINYGO',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'LUA',
	'ZIG',
	'LISP',
	'RUBY',
	'HASKELL',
	'R',
	'OCTAVE',
	'PHP'
]);
export const argsLabels: Partial<Record<PlaygroundLanguage, string>> = {
	HASKELL: 'GHC Args'
};
export const compilerDiagnosticLanguages = new Set<PlaygroundLanguage>([
	'JAVA',
	'RUST',
	'GO',
	'D',
	'CSHARP',
	'FSHARP',
	'VBNET',
	'PROLOG',
	'GLEAM',
	'PERL',
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
	'SQLITE',
	'PHP'
]);

export const dotnetMonacoLspLanguages: Record<string, DotnetLspLanguage> = {
	csharp: 'csharp',
	fsharp: 'fsharp',
	vb: 'vbnet'
};
export const defaultLanguageAliases: Record<string, string> = {
	vb: 'vbnet',
	sql: 'sqlite'
};
export const debugViewLanguages = new Set(['cpp']);
export const diagnosticMarkerLanguages = new Set([
	'c',
	'java',
	'python',
	'rust',
	'go',
	'd',
	'csharp',
	'fsharp',
	'vb',
	'erlang',
	'prolog',
	'gleam',
	'perl',
	'ocaml',
	'javascript',
	'typescript',
	'wat',
	'lua',
	'zig',
	'lisp',
	'haskell',
	'r',
	'octave',
	'cpp'
]);
export const monacoLanguageContributionLoaders: Record<string, MonacoLanguageContributionLoader> = {
	c: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	cpp: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	csharp: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
	elixir: () => import('monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution.js'),
	go: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
	graphql: () => import('monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution.js'),
	java: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
	javascript: () =>
		import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
	typescript: () =>
		import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
	pascal: () => import('monaco-editor/esm/vs/basic-languages/pascal/pascal.contribution.js'),
	perl: () => import('monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js'),
	tcl: () => import('monaco-editor/esm/vs/basic-languages/tcl/tcl.contribution.js'),
	php: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
	python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
	r: () => import('monaco-editor/esm/vs/basic-languages/r/r.contribution.js'),
	ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
	rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
	sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
	vb: () => import('monaco-editor/esm/vs/basic-languages/vb/vb.contribution.js')
};
