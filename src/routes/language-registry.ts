export type PlaygroundLanguage =
	| 'C'
	| 'CPP'
	| 'OBJC'
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
	| 'JULIA'
	| 'NIM'
	| 'BASH'
	| 'CLOJURESCRIPT'
	| 'OCAML'
	| 'TINYGO'
	| 'JAVASCRIPT'
	| 'TYPESCRIPT'
	| 'ASSEMBLYSCRIPT'
	| 'WAT'
	| 'WASM'
	| 'LUA'
	| 'ZIG'
	| 'LISP'
	| 'RUBY'
	| 'HASKELL'
	| 'R'
	| 'OCTAVE'
	| 'FORTRAN'
	| 'COBOL'
	| 'GRAPHQL'
	| 'DUCKDB'
	| 'SQLITE'
	| 'PHP'
	| 'JSON'
	| 'YAML'
	| 'TOML'
	| 'HTML'
	| 'CSS'
	| 'MARKDOWN';

export type RuntimeLspCapability =
	| 'elixir'
	| 'erlang'
	| 'gleam'
	| 'd'
	| 'tcl'
	| 'pascal'
	| 'go'
	| 'rust'
	| 'zig'
	| 'lua'
	| 'janet'
	| 'lisp'
	| 'ocaml'
	| 'haskell'
	| 'fortran'
	| 'sql'
	| 'prolog'
	| 'ruby'
	| 'r'
	| 'octave'
	| 'awk'
	| 'perl'
	| 'wasm';

export type DotnetLspLanguage = 'csharp' | 'fsharp' | 'vbnet';

type MonacoLanguageContributionLoader = () => Promise<unknown>;

export const playgroundLanguages: PlaygroundLanguage[] = [
	'C',
	'CPP',
	'OBJC',
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
	'JULIA',
	'NIM',
	'BASH',
	'CLOJURESCRIPT',
	'OCAML',
	'TINYGO',
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
	'FORTRAN',
	'COBOL',
	'GRAPHQL',
	'DUCKDB',
	'SQLITE',
	'PHP',
	'JSON',
	'YAML',
	'TOML',
	'HTML',
	'CSS',
	'MARKDOWN'
];

export const languageLabels: Record<PlaygroundLanguage, string> = {
	C: 'C',
	CPP: 'C++',
	OBJC: 'Objective-C',
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
	JULIA: 'Julia',
	NIM: 'Nim',
	BASH: 'Bash',
	CLOJURESCRIPT: 'ClojureScript',
	OCAML: 'OCaml',
	TINYGO: 'TinyGo',
	JAVASCRIPT: 'JavaScript',
	TYPESCRIPT: 'TypeScript',
	ASSEMBLYSCRIPT: 'AssemblyScript',
	WAT: 'WAT',
	WASM: 'WASM',
	LUA: 'Lua',
	ZIG: 'Zig',
	LISP: 'Scheme',
	RUBY: 'Ruby',
	HASKELL: 'Haskell',
	R: 'R',
	OCTAVE: 'Octave',
	FORTRAN: 'Fortran',
	COBOL: 'COBOL',
	GRAPHQL: 'GraphQL',
	DUCKDB: 'DuckDB',
	SQLITE: 'SQLite',
	PHP: 'PHP',
	JSON: 'JSON',
	YAML: 'YAML',
	TOML: 'TOML',
	HTML: 'HTML',
	CSS: 'CSS',
	MARKDOWN: 'Markdown'
};

export const editorLanguages: Record<PlaygroundLanguage, string> = {
	C: 'c',
	CPP: 'cpp',
	OBJC: 'objective-c',
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
	JULIA: 'julia',
	NIM: 'nim',
	BASH: 'shell',
	CLOJURESCRIPT: 'clojure',
	OCAML: 'ocaml',
	TINYGO: 'go',
	JAVASCRIPT: 'javascript',
	TYPESCRIPT: 'typescript',
	ASSEMBLYSCRIPT: 'typescript',
	WAT: 'wat',
	WASM: 'wasm',
	LUA: 'lua',
	ZIG: 'zig',
	LISP: 'lisp',
	RUBY: 'ruby',
	HASKELL: 'haskell',
	R: 'r',
	OCTAVE: 'octave',
	FORTRAN: 'fortran',
	COBOL: 'cobol',
	GRAPHQL: 'graphql',
	DUCKDB: 'sql',
	SQLITE: 'sql',
	PHP: 'php',
	JSON: 'json',
	YAML: 'yaml',
	TOML: 'toml',
	HTML: 'html',
	CSS: 'css',
	MARKDOWN: 'markdown'
};

export const debugLspLanguages = new Set<PlaygroundLanguage>(['CPP']);
export const clangdLspLanguages = new Set<PlaygroundLanguage>(['C', 'CPP', 'OBJC']);
export const dotnetLspLanguages = new Set<PlaygroundLanguage>(['CSHARP', 'FSHARP', 'VBNET']);
export const typescriptLspLanguages = new Set<PlaygroundLanguage>(['JAVASCRIPT', 'TYPESCRIPT']);
export const lspLanguageOverrides: Partial<Record<PlaygroundLanguage, string>> = {
	ASSEMBLYSCRIPT: 'assemblyscript',
	DUCKDB: 'duckdb'
};
export const editorOnlyLanguages = new Set<PlaygroundLanguage>([
	'GRAPHQL',
	'JSON',
	'YAML',
	'TOML',
	'HTML',
	'CSS',
	'MARKDOWN'
]);
export const runtimeLspCapabilities: Partial<Record<PlaygroundLanguage, RuntimeLspCapability>> = {
	ELIXIR: 'elixir',
	ERLANG: 'erlang',
	GLEAM: 'gleam',
	D: 'd',
	TCL: 'tcl',
	PASCAL: 'pascal',
	GO: 'go',
	RUST: 'rust',
	ZIG: 'zig',
	LUA: 'lua',
	JANET: 'janet',
	LISP: 'lisp',
	OCAML: 'ocaml',
	HASKELL: 'haskell',
	FORTRAN: 'fortran',
	SQLITE: 'sql',
	PROLOG: 'prolog',
	RUBY: 'ruby',
	R: 'r',
	OCTAVE: 'octave',
	AWK: 'awk',
	PERL: 'perl',
	WASM: 'wasm'
};
export const argsHelpLanguages = new Set<PlaygroundLanguage>([
	'OBJC',
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
	'BASH',
	'CLOJURESCRIPT',
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
	'PHP',
	'COBOL'
]);
export const argsLabels: Partial<Record<PlaygroundLanguage, string>> = {
	HASKELL: 'GHC Args'
};
export const compilerDiagnosticLanguages = new Set<PlaygroundLanguage>([
	'OBJC',
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
	nimrod: 'nim',
	objc: 'objective-c',
	objectivec: 'objective-c',
	'objective-c': 'objective-c',
	objective_c: 'objective-c',
	vb: 'vbnet',
	sql: 'sqlite'
};
export const debugViewLanguages = new Set(['cpp']);
export const diagnosticMarkerLanguages = new Set([
	'c',
	'objective-c',
	'java',
	'python',
	'rust',
	'go',
	'd',
	'csharp',
	'fsharp',
	'vb',
	'elixir',
	'erlang',
	'prolog',
	'gleam',
	'tcl',
	'pascal',
	'perl',
	'awk',
	'ocaml',
	'javascript',
	'typescript',
	'wat',
	'wasm',
	'lua',
	'janet',
	'julia',
	'nim',
	'zig',
	'lisp',
	'haskell',
	'fortran',
	'cobol',
	'r',
	'octave',
	'cpp',
	'json',
	'yaml',
	'toml',
	'html',
	'css',
	'markdown'
]);
export const monacoLanguageContributionLoaders: Record<string, MonacoLanguageContributionLoader> = {
	c: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	cpp: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	'objective-c': () =>
		import('monaco-editor/esm/vs/basic-languages/objective-c/objective-c.contribution.js'),
	csharp: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
	clojure: () => import('monaco-editor/esm/vs/basic-languages/clojure/clojure.contribution.js'),
	css: () => import('monaco-editor/esm/vs/basic-languages/css/css.contribution.js'),
	elixir: () => import('monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution.js'),
	go: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
	graphql: () => import('monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution.js'),
	html: () => import('monaco-editor/esm/vs/basic-languages/html/html.contribution.js'),
	java: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
	javascript: () =>
		import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
	json: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
	markdown: () =>
		import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
	typescript: () =>
		import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'),
	pascal: () => import('monaco-editor/esm/vs/basic-languages/pascal/pascal.contribution.js'),
	perl: () => import('monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js'),
	tcl: () => import('monaco-editor/esm/vs/basic-languages/tcl/tcl.contribution.js'),
	php: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
	python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
	r: () => import('monaco-editor/esm/vs/basic-languages/r/r.contribution.js'),
	ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
	shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
	rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
	sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
	vb: () => import('monaco-editor/esm/vs/basic-languages/vb/vb.contribution.js'),
	yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js')
};
