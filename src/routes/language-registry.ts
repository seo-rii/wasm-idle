import { supportedLanguageIds, type CanonicalLanguageId } from '@wasm-idle/core';

type PlaygroundRuntimeLanguage = Exclude<CanonicalLanguageId, 'PYTHON3'> | 'PYTHON';

const editorOnlyLanguageIds = ['JSON', 'YAML', 'TOML', 'HTML', 'CSS', 'MARKDOWN'] as const;

export type PlaygroundLanguage = PlaygroundRuntimeLanguage | (typeof editorOnlyLanguageIds)[number];

export type RuntimeLspCapability =
	| 'php'
	| 'forth'
	| 'c3'
	| 'rescript'
	| 'v'
	| 'lean4'
	| 'java'
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
	| 'postgresql'
	| 'bash'
	| 'cobol'
	| 'prolog'
	| 'ruby'
	| 'r'
	| 'octave'
	| 'awk'
	| 'perl'
	| 'nim'
	| 'wasm';

export type DotnetLspLanguage = 'csharp' | 'fsharp' | 'vbnet';

type MonacoLanguageContributionLoader = () => Promise<unknown>;

type PlaygroundLspProvider = 'clangd' | 'dotnet' | 'typescript';

export interface PlaygroundLanguageDescriptor {
	readonly label: string;
	readonly editorLanguage: string;
	readonly lspProvider?: PlaygroundLspProvider;
	readonly lspLanguageOverride?: string;
	readonly runtimeLspCapability?: RuntimeLspCapability;
	readonly supportsArgs?: boolean;
	readonly argsLabel?: string;
	readonly compilerDiagnostics?: boolean;
	readonly diagnosticMarkers?: boolean;
}

export const playgroundLanguages: PlaygroundLanguage[] = [
	...supportedLanguageIds.map<PlaygroundRuntimeLanguage>((language) =>
		language === 'PYTHON3' ? 'PYTHON' : language
	),
	...editorOnlyLanguageIds
];

export const playgroundLanguageDescriptors: Readonly<
	Record<PlaygroundLanguage, PlaygroundLanguageDescriptor>
> = {
	APL: { label: 'GNU APL', editorLanguage: 'plaintext', supportsArgs: true },
	MOONBIT: {
		label: 'MoonBit',
		editorLanguage: 'plaintext',
		supportsArgs: true,
		argsLabel: 'Program arguments'
	},
	COQ: {
		label: 'Coq 8.17.1',
		editorLanguage: 'plaintext',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	SMALLTALK: {
		label: 'Smalltalk (Amber)',
		editorLanguage: 'plaintext',
		supportsArgs: true,
		argsLabel: 'Program arguments'
	},
	BC: { label: 'bc 7.0.3', editorLanguage: 'plaintext', supportsArgs: true },
	UIUA: { label: 'Uiua', editorLanguage: 'plaintext', supportsArgs: true },
	SED: {
		label: 'sed — BusyBox',
		editorLanguage: 'plaintext',
		supportsArgs: true,
		argsLabel: 'sed options / input files'
	},
	PICAT: { label: 'Picat', editorLanguage: 'plaintext' },
	PARIGP: { label: 'PARI/GP', editorLanguage: 'plaintext' },
	WREN: { label: 'Wren', editorLanguage: 'plaintext' },
	SQUIRREL: { label: 'Squirrel', editorLanguage: 'cpp' },
	UHMLANG: { label: 'UHMLANG (엄준식)', editorLanguage: 'plaintext' },
	LOLCODE: { label: 'LOLCODE 1.3', editorLanguage: 'plaintext' },
	APECODE: { label: 'APECode', editorLanguage: 'plaintext' },
	GOLFSCRIPT: {
		label: 'GolfScript',
		editorLanguage: 'plaintext',
		supportsArgs: true,
		argsLabel: 'Interpreter options / -- values'
	},
	AHEUI: { label: 'Aheui', editorLanguage: 'plaintext' },
	MALBOLGE: { label: 'Malbolge', editorLanguage: 'plaintext' },
	WHITESPACE: { label: 'Whitespace', editorLanguage: 'plaintext' },
	BRAINFUCK: { label: 'Brainfuck', editorLanguage: 'plaintext' },
	BEFUNGE93: { label: 'Befunge-93', editorLanguage: 'plaintext' },
	C3: {
		label: 'C3 (byte ABI)',
		editorLanguage: 'c',
		runtimeLspCapability: 'c3',
		lspLanguageOverride: 'c3',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	C: {
		label: 'C',
		editorLanguage: 'c',
		lspProvider: 'clangd',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	CPP: {
		label: 'C++',
		editorLanguage: 'cpp',
		lspProvider: 'clangd',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	OBJC: {
		label: 'Objective-C',
		editorLanguage: 'objective-c',
		lspProvider: 'clangd',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	OBJECTIVECXX: {
		label: 'Objective-C++',
		editorLanguage: 'objective-c',
		lspProvider: 'clangd',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	PYTHON: { label: 'Python — Pyodide', editorLanguage: 'python', diagnosticMarkers: true },
	JAVA: {
		label: 'Java',
		editorLanguage: 'java',
		runtimeLspCapability: 'java',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	RUST: {
		label: 'Rust',
		editorLanguage: 'rust',
		runtimeLspCapability: 'rust',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	GO: {
		label: 'Go',
		editorLanguage: 'go',
		runtimeLspCapability: 'go',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	D: {
		label: 'D',
		editorLanguage: 'd',
		runtimeLspCapability: 'd',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	CSHARP: {
		label: 'C#',
		editorLanguage: 'csharp',
		lspProvider: 'dotnet',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	FSHARP: {
		label: 'F#',
		editorLanguage: 'fsharp',
		lspProvider: 'dotnet',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	VBNET: {
		label: 'VB.NET',
		editorLanguage: 'vb',
		lspProvider: 'dotnet',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	ELIXIR: {
		label: 'Elixir',
		editorLanguage: 'elixir',
		runtimeLspCapability: 'elixir',
		diagnosticMarkers: true
	},
	ERLANG: {
		label: 'Erlang',
		editorLanguage: 'erlang',
		runtimeLspCapability: 'erlang',
		diagnosticMarkers: true
	},
	PROLOG: {
		label: 'Prolog',
		editorLanguage: 'prolog',
		runtimeLspCapability: 'prolog',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	DART: {
		label: 'Dart 3.14',
		editorLanguage: 'dart',
		supportsArgs: true,
		argsLabel: 'Program arguments'
	},
	SCALA: {
		label: 'Scala 3 — Scala.js (experimental)',
		editorLanguage: 'scala',
		supportsArgs: true,
		argsLabel: 'Program arguments',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	GLEAM: {
		label: 'Gleam',
		editorLanguage: 'gleam',
		runtimeLspCapability: 'gleam',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	VERILOG: {
		label: 'Verilog — Icarus',
		editorLanguage: 'plaintext',
		supportsArgs: true,
		argsLabel: 'Simulation plusargs',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	GRAIN: {
		label: 'Grain',
		lspLanguageOverride: 'grain',
		editorLanguage: 'rust',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	PERL: {
		label: 'Perl',
		editorLanguage: 'perl',
		runtimeLspCapability: 'perl',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	TCL: {
		label: 'Tcl',
		editorLanguage: 'tcl',
		runtimeLspCapability: 'tcl',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	AWK: {
		label: 'AWK',
		editorLanguage: 'awk',
		runtimeLspCapability: 'awk',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	PASCAL: {
		label: 'Pascal',
		editorLanguage: 'pascal',
		runtimeLspCapability: 'pascal',
		diagnosticMarkers: true
	},
	FORTH: {
		label: 'Forth',
		editorLanguage: 'forth',
		runtimeLspCapability: 'forth',
		diagnosticMarkers: true
	},
	J: { label: 'J', editorLanguage: 'j' },
	SML: { label: 'Standard ML', editorLanguage: 'plaintext', supportsArgs: true },
	BQN: { label: 'BQN', editorLanguage: 'bqn' },
	JANET: {
		label: 'Janet',
		editorLanguage: 'janet',
		runtimeLspCapability: 'janet',
		diagnosticMarkers: true
	},
	JULIA: {
		label: 'Julia 1.3.0-DEV.560 (legacy)',
		editorLanguage: 'julia',
		diagnosticMarkers: true
	},
	NIM: {
		label: 'Nim',
		editorLanguage: 'nim',
		diagnosticMarkers: true,
		runtimeLspCapability: 'nim'
	},
	BASH: {
		label: 'Bash',
		editorLanguage: 'shell',
		lspLanguageOverride: 'bash',
		runtimeLspCapability: 'bash',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	CLOJURESCRIPT: { label: 'ClojureScript', editorLanguage: 'clojure', supportsArgs: true },
	RESCRIPT: {
		label: 'ReScript',
		lspLanguageOverride: 'rescript',
		runtimeLspCapability: 'rescript',
		editorLanguage: 'rust',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	HY: { label: 'Hy — Pyodide', editorLanguage: 'clojure' },
	OCAML: {
		label: 'OCaml',
		editorLanguage: 'ocaml',
		runtimeLspCapability: 'ocaml',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	JAVASCRIPT: {
		label: 'JavaScript — Browser',
		editorLanguage: 'javascript',
		lspProvider: 'typescript',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	COFFEESCRIPT: {
		label: 'CoffeeScript',
		editorLanguage: 'coffeescript',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	TYPESCRIPT: {
		label: 'TypeScript',
		editorLanguage: 'typescript',
		lspProvider: 'typescript',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	ASSEMBLYSCRIPT: {
		label: 'AssemblyScript',
		editorLanguage: 'typescript',
		lspLanguageOverride: 'assemblyscript',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	WAT: {
		label: 'WAT',
		editorLanguage: 'wat',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	WASM: {
		label: 'WASM',
		editorLanguage: 'wasm',
		runtimeLspCapability: 'wasm',
		diagnosticMarkers: true
	},
	LUA: {
		label: 'Lua',
		editorLanguage: 'lua',
		runtimeLspCapability: 'lua',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	FENNEL: {
		label: 'Fennel',
		editorLanguage: 'clojure',
		lspLanguageOverride: 'fennel',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	ZIG: {
		label: 'Zig',
		editorLanguage: 'zig',
		runtimeLspCapability: 'zig',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	LISP: {
		label: 'Scheme — Puppy Scheme',
		editorLanguage: 'lisp',
		runtimeLspCapability: 'lisp',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	COMMONLISP: {
		label: 'Common Lisp — ECL',
		editorLanguage: 'clojure'
	},
	RUBY: {
		label: 'Ruby',
		editorLanguage: 'ruby',
		runtimeLspCapability: 'ruby',
		supportsArgs: true,
		compilerDiagnostics: true
	},
	HASKELL: {
		label: 'Haskell',
		editorLanguage: 'haskell',
		runtimeLspCapability: 'haskell',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	R: {
		label: 'R',
		editorLanguage: 'r',
		runtimeLspCapability: 'r',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	OCTAVE: {
		label: 'MATLAB-compatible — GNU Octave',
		editorLanguage: 'octave',
		runtimeLspCapability: 'octave',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	LFORTRAN: {
		label: 'LFortran (experimental)',
		editorLanguage: 'fortran',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	LEAN4: {
		label: 'Lean 4',
		editorLanguage: 'lean4',
		runtimeLspCapability: 'lean4',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	FORTRAN: {
		label: 'Fortran',
		editorLanguage: 'fortran',
		runtimeLspCapability: 'fortran',
		diagnosticMarkers: true
	},
	COBOL: {
		label: 'COBOL',
		editorLanguage: 'cobol',
		runtimeLspCapability: 'cobol',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	V: {
		label: 'V',
		editorLanguage: 'go',
		runtimeLspCapability: 'v',
		lspLanguageOverride: 'v',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	TINYGO: {
		label: 'TinyGo',
		editorLanguage: 'go',
		supportsArgs: true,
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	GRAPHQL: { label: 'GraphQL', editorLanguage: 'graphql', diagnosticMarkers: true },
	DUCKDB: { label: 'SQL — DuckDB', editorLanguage: 'sql', lspLanguageOverride: 'duckdb' },
	SQLITE: {
		label: 'SQL — SQLite dialect',
		editorLanguage: 'sql',
		runtimeLspCapability: 'sql',
		compilerDiagnostics: true
	},
	POSTGRESQL: {
		label: 'SQL — PostgreSQL (PGlite)',
		editorLanguage: 'pgsql',
		lspLanguageOverride: 'postgresql',
		runtimeLspCapability: 'postgresql',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	PHP: {
		label: 'PHP',
		editorLanguage: 'php',
		runtimeLspCapability: 'php',
		supportsArgs: true,
		compilerDiagnostics: true
	},
	JSON: { label: 'JSON', editorLanguage: 'json', diagnosticMarkers: true },
	YAML: { label: 'YAML', editorLanguage: 'yaml', diagnosticMarkers: true },
	TOML: { label: 'TOML', editorLanguage: 'toml', diagnosticMarkers: true },
	HTML: { label: 'HTML', editorLanguage: 'html', diagnosticMarkers: true },
	CSS: { label: 'CSS', editorLanguage: 'css', diagnosticMarkers: true },
	MARKDOWN: { label: 'Markdown', editorLanguage: 'markdown', diagnosticMarkers: true }
};

const languageDescriptorEntries = Object.entries(playgroundLanguageDescriptors) as Array<
	[PlaygroundLanguage, PlaygroundLanguageDescriptor]
>;

export const languageLabels = Object.fromEntries(
	languageDescriptorEntries.map(([language, descriptor]) => [language, descriptor.label])
) as Record<PlaygroundLanguage, string>;
export const editorLanguages = Object.fromEntries(
	languageDescriptorEntries.map(([language, descriptor]) => [language, descriptor.editorLanguage])
) as Record<PlaygroundLanguage, string>;

export const debugLspLanguages = new Set<PlaygroundLanguage>(['CPP']);
export const clangdLspLanguages = new Set<PlaygroundLanguage>(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.lspProvider === 'clangd')
		.map(([language]) => language)
);
export const dotnetLspLanguages = new Set<PlaygroundLanguage>(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.lspProvider === 'dotnet')
		.map(([language]) => language)
);
export const typescriptLspLanguages = new Set<PlaygroundLanguage>(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.lspProvider === 'typescript')
		.map(([language]) => language)
);
export const lspLanguageOverrides = Object.fromEntries(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.lspLanguageOverride !== undefined)
		.map(([language, descriptor]) => [language, descriptor.lspLanguageOverride!])
) as Partial<Record<PlaygroundLanguage, string>>;
export const editorOnlyLanguages = new Set<PlaygroundLanguage>(editorOnlyLanguageIds);
export const runtimeLspCapabilities = Object.fromEntries(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.runtimeLspCapability !== undefined)
		.map(([language, descriptor]) => [language, descriptor.runtimeLspCapability!])
) as Partial<Record<PlaygroundLanguage, RuntimeLspCapability>>;
export const argsHelpLanguages = new Set<PlaygroundLanguage>(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.supportsArgs)
		.map(([language]) => language)
);
export const argsLabels = Object.fromEntries(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.argsLabel !== undefined)
		.map(([language, descriptor]) => [language, descriptor.argsLabel!])
) as Partial<Record<PlaygroundLanguage, string>>;
export const compilerDiagnosticLanguages = new Set<PlaygroundLanguage>(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.compilerDiagnostics)
		.map(([language]) => language)
);

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
	sql: 'sqlite',
	pgsql: 'postgresql'
};
export const debugViewLanguages = new Set(['cpp']);
export const diagnosticMarkerLanguages = new Set(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.diagnosticMarkers)
		.map(([, descriptor]) => descriptor.editorLanguage)
);
export const monacoLanguageContributionLoaders: Record<string, MonacoLanguageContributionLoader> = {
	c: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	coffeescript: () =>
		import('monaco-editor/esm/vs/basic-languages/coffee/coffee.contribution.js'),
	cpp: () => import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js'),
	'objective-c': () =>
		import('monaco-editor/esm/vs/basic-languages/objective-c/objective-c.contribution.js'),
	csharp: () => import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
	clojure: () => import('monaco-editor/esm/vs/basic-languages/clojure/clojure.contribution.js'),
	dart: () => import('monaco-editor/esm/vs/basic-languages/dart/dart.contribution.js'),
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
	pgsql: () => import('monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution.js'),
	php: () => import('monaco-editor/esm/vs/basic-languages/php/php.contribution.js'),
	python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
	r: () => import('monaco-editor/esm/vs/basic-languages/r/r.contribution.js'),
	ruby: () => import('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js'),
	scala: () => import('monaco-editor/esm/vs/basic-languages/scala/scala.contribution.js'),
	shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
	rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
	sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
	vb: () => import('monaco-editor/esm/vs/basic-languages/vb/vb.contribution.js'),
	yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js')
};

const playgroundLanguageAliases: Record<string, PlaygroundLanguage> = {
	whitespace: 'WHITESPACE',
	malbolge: 'MALBOLGE',
	aheui: 'AHEUI',
	아희: 'AHEUI',
	uhmlang: 'UHMLANG',
	umjunsik: 'UHMLANG',
	엄준식: 'UHMLANG',
	coq: 'COQ',
	smalltalk: 'SMALLTALK',
	picat: 'PICAT',
	moonbit: 'MOONBIT',
	parigp: 'PARIGP',
	'pari/gp': 'PARIGP',
	gp: 'PARIGP',
	wren: 'WREN',
	squirrel: 'SQUIRREL',
	lolcode: 'LOLCODE',
	lol: 'LOLCODE',
	apecode: 'APECODE',
	ape: 'APECODE',
	golfscript: 'GOLFSCRIPT',
	'golf-script': 'GOLFSCRIPT',
	brainfuck: 'BRAINFUCK',
	bf: 'BRAINFUCK',
	befunge93: 'BEFUNGE93',
	befunge: 'BEFUNGE93',
	'befunge-93': 'BEFUNGE93',
	python: 'PYTHON',
	python3: 'PYTHON',
	pypy3: 'PYTHON',
	c: 'C',
	cpp: 'CPP',
	cxx: 'CPP',
	objc: 'OBJC',
	objectivec: 'OBJC',
	'objective-c': 'OBJC',
	objective_c: 'OBJC',
	objcxx: 'OBJECTIVECXX',
	objcpp: 'OBJECTIVECXX',
	objectivecxx: 'OBJECTIVECXX',
	'objective-c++': 'OBJECTIVECXX',
	objective_cxx: 'OBJECTIVECXX',
	java: 'JAVA',
	rust: 'RUST',
	go: 'GO',
	d: 'D',
	dlang: 'D',
	csharp: 'CSHARP',
	'c#': 'CSHARP',
	cs: 'CSHARP',
	fsharp: 'FSHARP',
	'f#': 'FSHARP',
	fs: 'FSHARP',
	vbnet: 'VBNET',
	vb: 'VBNET',
	visualbasic: 'VBNET',
	elixir: 'ELIXIR',
	erlang: 'ERLANG',
	erl: 'ERLANG',
	prolog: 'PROLOG',
	swipl: 'PROLOG',
	swi: 'PROLOG',
	gleam: 'GLEAM',
	grain: 'GRAIN',
	verilog: 'VERILOG',
	perl: 'PERL',
	tcl: 'TCL',
	tclsh: 'TCL',
	awk: 'AWK',
	gawk: 'AWK',
	pascal: 'PASCAL',
	pas: 'PASCAL',
	fpc: 'PASCAL',
	forth: 'FORTH',
	gforth: 'FORTH',
	j: 'J',
	apl: 'APL',
	gnuapl: 'APL',
	'gnu-apl': 'APL',
	dart: 'DART',
	sml: 'SML',
	standardml: 'SML',
	bqn: 'BQN',
	bc: 'BC',
	uiua: 'UIUA',
	janet: 'JANET',
	julia: 'JULIA',
	jl: 'JULIA',
	c3: 'C3',
	nim: 'NIM',
	nimrod: 'NIM',
	sed: 'SED',
	bash: 'BASH',
	sh: 'BASH',
	shell: 'BASH',
	clojurescript: 'CLOJURESCRIPT',
	cljs: 'CLOJURESCRIPT',
	rescript: 'RESCRIPT',
	res: 'RESCRIPT',
	hy: 'HY',
	hylang: 'HY',
	ocaml: 'OCAML',
	coffeescript: 'COFFEESCRIPT',
	coffee: 'COFFEESCRIPT',
	javascript: 'JAVASCRIPT',
	js: 'JAVASCRIPT',
	typescript: 'TYPESCRIPT',
	ts: 'TYPESCRIPT',
	assemblyscript: 'ASSEMBLYSCRIPT',
	as: 'ASSEMBLYSCRIPT',
	wat: 'WAT',
	wast: 'WAT',
	wasm: 'WASM',
	wasm32: 'WASM',
	lua: 'LUA',
	fennel: 'FENNEL',
	fnl: 'FENNEL',
	zig: 'ZIG',
	lisp: 'LISP',
	scheme: 'LISP',
	scm: 'LISP',
	commonlisp: 'COMMONLISP',
	'common-lisp': 'COMMONLISP',
	cl: 'COMMONLISP',
	ecl: 'COMMONLISP',
	ruby: 'RUBY',
	rb: 'RUBY',
	haskell: 'HASKELL',
	hs: 'HASKELL',
	r: 'R',
	octave: 'OCTAVE',
	matlab: 'OCTAVE',
	lfortran: 'LFORTRAN',
	lean: 'LEAN4',
	lean4: 'LEAN4',
	fortran: 'FORTRAN',
	f90: 'FORTRAN',
	f95: 'FORTRAN',
	cobol: 'COBOL',
	cob: 'COBOL',
	cbl: 'COBOL',
	gnucobol: 'COBOL',
	v: 'V',
	vlang: 'V',
	tinygo: 'TINYGO',
	graphql: 'GRAPHQL',
	gql: 'GRAPHQL',
	duckdb: 'DUCKDB',
	sqlite: 'SQLITE',
	sql: 'SQLITE',
	postgresql: 'POSTGRESQL',
	postgres: 'POSTGRESQL',
	pgsql: 'POSTGRESQL',
	pglite: 'POSTGRESQL',
	php: 'PHP',
	json: 'JSON',
	jsonc: 'JSON',
	yaml: 'YAML',
	yml: 'YAML',
	toml: 'TOML',
	html: 'HTML',
	htm: 'HTML',
	css: 'CSS',
	markdown: 'MARKDOWN',
	md: 'MARKDOWN'
};

/** Resolve language names accepted by workspace URLs and legacy backups. */
export function normalizeRequestedLanguage(value: string | null): PlaygroundLanguage | null {
	if (!value) return null;
	const alias = value.trim().toLowerCase();
	return Object.hasOwn(playgroundLanguageAliases, alias)
		? playgroundLanguageAliases[alias]
		: null;
}
