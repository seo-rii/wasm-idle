import type {
	BoundSandbox,
	PlaygroundBinding,
	Sandbox,
	SandboxRuntimeAssets
} from '$lib/playground/sandbox';
import { createPlaygroundBinding as createCorePlaygroundBinding } from '@wasm-idle/core';

const sandboxCache: { [key: string]: Sandbox } = {};

interface SandboxRoute {
	aliases: readonly string[];
	load: () => Promise<Sandbox>;
}

const sandboxRoutes = [
	{
		aliases: ['PYTHON3', 'PYTHON', 'PYPY3'],
		load: async () => {
			const { default: Python } = await import('$lib/playground/python');
			return new Python();
		}
	},
	{
		aliases: ['C'],
		load: async () => {
			const { default: Clang } = await import('$lib/playground/clang');
			return new Clang('C');
		}
	},
	{
		aliases: ['CPP'],
		load: async () => {
			const { default: Clang } = await import('$lib/playground/clang');
			return new Clang('CPP');
		}
	},
	{
		aliases: ['JAVA'],
		load: async () => {
			const { default: Java } = await import('$lib/playground/java');
			return new Java();
		}
	},
	{
		aliases: ['RUST'],
		load: async () => {
			const { default: Rust } = await import('$lib/playground/rust');
			return new Rust();
		}
	},
	{
		aliases: ['GO'],
		load: async () => {
			const { default: Go } = await import('$lib/playground/go');
			return new Go();
		}
	},
	{
		aliases: ['D', 'DLANG'],
		load: async () => {
			const { default: D } = await import('$lib/playground/d');
			return new D();
		}
	},
	{
		aliases: ['CSHARP', 'C#'],
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('CSHARP');
		}
	},
	{
		aliases: ['FSHARP', 'F#'],
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('FSHARP');
		}
	},
	{
		aliases: ['VBNET', 'VB', 'VISUALBASIC'],
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('VBNET');
		}
	},
	{
		aliases: ['ELIXIR'],
		load: async () => {
			const { default: Elixir } = await import('$lib/playground/elixir');
			return new Elixir();
		}
	},
	{
		aliases: ['ERLANG', 'ERL'],
		load: async () => {
			const { default: Elixir } = await import('$lib/playground/elixir');
			return new Elixir('ERLANG');
		}
	},
	{
		aliases: ['PROLOG', 'SWIPL', 'SWI'],
		load: async () => {
			const { default: Prolog } = await import('$lib/playground/prolog');
			return new Prolog();
		}
	},
	{
		aliases: ['GLEAM'],
		load: async () => {
			const { default: Gleam } = await import('$lib/playground/gleam');
			return new Gleam();
		}
	},
	{
		aliases: ['PERL'],
		load: async () => {
			const { default: Perl } = await import('$lib/playground/perl');
			return new Perl();
		}
	},
	{
		aliases: ['TCL', 'TCLSH'],
		load: async () => {
			const { default: Tcl } = await import('$lib/playground/tcl');
			return new Tcl();
		}
	},
	{
		aliases: ['AWK', 'GAWK'],
		load: async () => {
			const { default: Awk } = await import('$lib/playground/awk');
			return new Awk();
		}
	},
	{
		aliases: ['PASCAL', 'PAS', 'FPC'],
		load: async () => {
			const { default: Pascal } = await import('$lib/playground/pascal');
			return new Pascal();
		}
	},
	{
		aliases: ['FORTH', 'GFORTH'],
		load: async () => {
			const { default: Forth } = await import('$lib/playground/forth');
			return new Forth();
		}
	},
	{
		aliases: ['J'],
		load: async () => {
			const { default: J } = await import('$lib/playground/j');
			return new J();
		}
	},
	{
		aliases: ['BQN'],
		load: async () => {
			const { default: Bqn } = await import('$lib/playground/bqn');
			return new Bqn();
		}
	},
	{
		aliases: ['JANET'],
		load: async () => {
			const { default: Janet } = await import('$lib/playground/janet');
			return new Janet();
		}
	},
	{
		aliases: ['JULIA', 'JL'],
		load: async () => {
			const { default: Julia } = await import('$lib/playground/julia');
			return new Julia();
		}
	},
	{
		aliases: ['NIM', 'NIMROD'],
		load: async () => {
			const { default: Nim } = await import('$lib/playground/nim');
			return new Nim();
		}
	},
	{
		aliases: ['TINYGO'],
		load: async () => {
			const { default: TinyGo } = await import('$lib/playground/tinygo');
			return new TinyGo();
		}
	},
	{
		aliases: ['OCAML'],
		load: async () => {
			const { default: Ocaml } = await import('$lib/playground/ocaml');
			return new Ocaml();
		}
	},
	{
		aliases: ['JAVASCRIPT', 'JS'],
		load: async () => {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			return new TypeScriptSandbox('JAVASCRIPT');
		}
	},
	{
		aliases: ['TYPESCRIPT', 'TS'],
		load: async () => {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			return new TypeScriptSandbox('TYPESCRIPT');
		}
	},
	{
		aliases: ['ASSEMBLYSCRIPT', 'AS'],
		load: async () => {
			const { default: AssemblyScript } = await import('$lib/playground/assemblyscript');
			return new AssemblyScript();
		}
	},
	{
		aliases: ['WAT'],
		load: async () => {
			const { default: Wat } = await import('$lib/playground/wat');
			return new Wat();
		}
	},
	{
		aliases: ['WASM', 'WASM32'],
		load: async () => {
			const { default: Wasm } = await import('$lib/playground/wasm');
			return new Wasm();
		}
	},
	{
		aliases: ['LUA'],
		load: async () => {
			const { default: Lua } = await import('$lib/playground/lua');
			return new Lua();
		}
	},
	{
		aliases: ['ZIG'],
		load: async () => {
			const { default: Zig } = await import('$lib/playground/zig');
			return new Zig();
		}
	},
	{
		aliases: ['LISP', 'SCHEME', 'SCM'],
		load: async () => {
			const { default: Lisp } = await import('$lib/playground/lisp');
			return new Lisp();
		}
	},
	{
		aliases: ['RUBY', 'RB'],
		load: async () => {
			const { default: Ruby } = await import('$lib/playground/ruby');
			return new Ruby();
		}
	},
	{
		aliases: ['HASKELL', 'HS'],
		load: async () => {
			const { default: Haskell } = await import('$lib/playground/haskell');
			return new Haskell();
		}
	},
	{
		aliases: ['R'],
		load: async () => {
			const { default: R } = await import('$lib/playground/r');
			return new R();
		}
	},
	{
		aliases: ['OCTAVE', 'MATLAB'],
		load: async () => {
			const { default: Octave } = await import('$lib/playground/octave');
			return new Octave();
		}
	},
	{
		aliases: ['DUCKDB'],
		load: async () => {
			const { default: DuckDB } = await import('$lib/playground/duckdb');
			return new DuckDB();
		}
	},
	{
		aliases: ['SQLITE', 'SQL'],
		load: async () => {
			const { default: Sqlite } = await import('$lib/playground/sqlite');
			return new Sqlite();
		}
	},
	{
		aliases: ['PHP'],
		load: async () => {
			const { default: Php } = await import('$lib/playground/php');
			return new Php();
		}
	}
] satisfies SandboxRoute[];

const sandboxRouteByLanguage = new Map<string, SandboxRoute>();
for (const route of sandboxRoutes) {
	for (const alias of route.aliases) sandboxRouteByLanguage.set(alias, route);
}

export const supportedLanguages = [
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
];

export function createPlaygroundBinding(runtimeAssets: SandboxRuntimeAssets): PlaygroundBinding {
	return createCorePlaygroundBinding(
		runtimeAssets as never,
		playground as never
	) as PlaygroundBinding;
}

async function playground(language: string): Promise<Sandbox>;
async function playground(
	language: string,
	runtimeAssets: SandboxRuntimeAssets
): Promise<BoundSandbox>;
async function playground(language: string, runtimeAssets?: SandboxRuntimeAssets) {
	if (sandboxCache[language]) {
		return runtimeAssets
			? createPlaygroundBinding(runtimeAssets).load(language)
			: sandboxCache[language];
	}
	const route = sandboxRouteByLanguage.get(language);
	if (!route) throw new Error(`Unsupported language: ${language}`);
	const sandbox = await route.load();
	for (const alias of route.aliases) sandboxCache[alias] = sandbox;
	return runtimeAssets ? createPlaygroundBinding(runtimeAssets).load(language) : sandbox;
}

export default playground;
