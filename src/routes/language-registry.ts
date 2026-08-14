import { supportedLanguageIds, type CanonicalLanguageId } from '@wasm-idle/core';

type PlaygroundRuntimeLanguage = Exclude<CanonicalLanguageId, 'PYTHON3'> | 'PYTHON';

const editorOnlyLanguageIds = [
	'GRAPHQL',
	'JSON',
	'YAML',
	'TOML',
	'HTML',
	'CSS',
	'MARKDOWN'
] as const;

export type PlaygroundLanguage = PlaygroundRuntimeLanguage | (typeof editorOnlyLanguageIds)[number];

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
	C: {
		label: 'C',
		editorLanguage: 'c',
		lspProvider: 'clangd',
		diagnosticMarkers: true
	},
	CPP: {
		label: 'C++',
		editorLanguage: 'cpp',
		lspProvider: 'clangd',
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
	PYTHON: { label: 'Python — Pyodide', editorLanguage: 'python', diagnosticMarkers: true },
	JAVA: {
		label: 'Java',
		editorLanguage: 'java',
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
	GLEAM: {
		label: 'Gleam',
		editorLanguage: 'gleam',
		runtimeLspCapability: 'gleam',
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
	FORTH: { label: 'Forth', editorLanguage: 'forth' },
	J: { label: 'J', editorLanguage: 'j' },
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
	NIM: { label: 'Nim', editorLanguage: 'nim', diagnosticMarkers: true },
	BASH: { label: 'Bash', editorLanguage: 'shell', supportsArgs: true },
	CLOJURESCRIPT: { label: 'ClojureScript', editorLanguage: 'clojure', supportsArgs: true },
	OCAML: {
		label: 'OCaml',
		editorLanguage: 'ocaml',
		runtimeLspCapability: 'ocaml',
		compilerDiagnostics: true,
		diagnosticMarkers: true
	},
	TINYGO: {
		label: 'TinyGo',
		editorLanguage: 'go',
		supportsArgs: true,
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
		supportsArgs: true,
		argsLabel: 'GHC Args',
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
	FORTRAN: {
		label: 'Fortran',
		editorLanguage: 'fortran',
		runtimeLspCapability: 'fortran',
		diagnosticMarkers: true
	},
	COBOL: {
		label: 'COBOL',
		editorLanguage: 'cobol',
		supportsArgs: true,
		diagnosticMarkers: true
	},
	GRAPHQL: { label: 'GraphQL', editorLanguage: 'graphql' },
	DUCKDB: { label: 'SQL — DuckDB', editorLanguage: 'sql', lspLanguageOverride: 'duckdb' },
	SQLITE: {
		label: 'SQL — SQLite dialect',
		editorLanguage: 'sql',
		runtimeLspCapability: 'sql',
		compilerDiagnostics: true
	},
	PHP: {
		label: 'PHP',
		editorLanguage: 'php',
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
	sql: 'sqlite'
};
export const debugViewLanguages = new Set(['cpp']);
export const diagnosticMarkerLanguages = new Set(
	languageDescriptorEntries
		.filter(([, descriptor]) => descriptor.diagnosticMarkers)
		.map(([, descriptor]) => descriptor.editorLanguage)
);
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
