import type {
	BoundSandbox,
	PlaygroundBinding,
	Sandbox,
	SandboxRuntimeAssets
} from '$lib/playground/sandbox';
import {
	createPlaygroundBinding as createCorePlaygroundBinding,
	isSupportedLanguageId,
	normalizeLanguageId,
	supportedLanguageIds,
	type CanonicalLanguageId
} from '@wasm-idle/core';

interface SandboxRoute {
	languageId: CanonicalLanguageId;
	load: () => Promise<Sandbox>;
}

const sandboxRoutes = [
	{
		languageId: 'C3',
		load: async () => {
			const { default: C3 } = await import('$lib/playground/c3');
			return new C3();
		}
	},
	{
		languageId: 'PYTHON3',
		load: async () => {
			const { default: Python } = await import('$lib/playground/python');
			return new Python();
		}
	},
	{
		languageId: 'C',
		load: async () => {
			const { default: Clang } = await import('$lib/playground/clang');
			return new Clang('C');
		}
	},
	{
		languageId: 'CPP',
		load: async () => {
			const { default: Clang } = await import('$lib/playground/clang');
			return new Clang('CPP');
		}
	},
	{
		languageId: 'OBJC',
		load: async () => {
			const { default: ObjectiveC } = await import('$lib/playground/objectivec');
			return new ObjectiveC();
		}
	},
	{
		languageId: 'JAVA',
		load: async () => {
			const { default: Java } = await import('$lib/playground/java');
			return new Java();
		}
	},
	{
		languageId: 'RUST',
		load: async () => {
			const { default: Rust } = await import('$lib/playground/rust');
			return new Rust();
		}
	},
	{
		languageId: 'GO',
		load: async () => {
			const { default: Go } = await import('$lib/playground/go');
			return new Go();
		}
	},
	{
		languageId: 'D',
		load: async () => {
			const { default: D } = await import('$lib/playground/d');
			return new D();
		}
	},
	{
		languageId: 'CSHARP',
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('CSHARP');
		}
	},
	{
		languageId: 'FSHARP',
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('FSHARP');
		}
	},
	{
		languageId: 'VBNET',
		load: async () => {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			return new Dotnet('VBNET');
		}
	},
	{
		languageId: 'ELIXIR',
		load: async () => {
			const { default: Elixir } = await import('$lib/playground/elixir');
			return new Elixir();
		}
	},
	{
		languageId: 'ERLANG',
		load: async () => {
			const { default: Elixir } = await import('$lib/playground/elixir');
			return new Elixir('ERLANG');
		}
	},
	{
		languageId: 'PROLOG',
		load: async () => {
			const { default: Prolog } = await import('$lib/playground/prolog');
			return new Prolog();
		}
	},
	{
		languageId: 'GLEAM',
		load: async () => {
			const { default: Gleam } = await import('$lib/playground/gleam');
			return new Gleam();
		}
	},
	{
		languageId: 'PERL',
		load: async () => {
			const { default: Perl } = await import('$lib/playground/perl');
			return new Perl();
		}
	},
	{
		languageId: 'TCL',
		load: async () => {
			const { default: Tcl } = await import('$lib/playground/tcl');
			return new Tcl();
		}
	},
	{
		languageId: 'AWK',
		load: async () => {
			const { default: Awk } = await import('$lib/playground/awk');
			return new Awk();
		}
	},
	{
		languageId: 'PASCAL',
		load: async () => {
			const { default: Pascal } = await import('$lib/playground/pascal');
			return new Pascal();
		}
	},
	{
		languageId: 'CLOJURESCRIPT',
		load: async () => {
			const { default: ClojureScript } = await import('$lib/playground/clojurescript');
			return new ClojureScript();
		}
	},
	{
		languageId: 'FORTH',
		load: async () => {
			const { default: Forth } = await import('$lib/playground/forth');
			return new Forth();
		}
	},
	{
		languageId: 'J',
		load: async () => {
			const { default: J } = await import('$lib/playground/j');
			return new J();
		}
	},
	{
		languageId: 'BQN',
		load: async () => {
			const { default: Bqn } = await import('$lib/playground/bqn');
			return new Bqn();
		}
	},
	{
		languageId: 'JANET',
		load: async () => {
			const { default: Janet } = await import('$lib/playground/janet');
			return new Janet();
		}
	},
	{
		languageId: 'JULIA',
		load: async () => {
			const { default: Julia } = await import('$lib/playground/julia');
			return new Julia();
		}
	},
	{
		languageId: 'NIM',
		load: async () => {
			const { default: Nim } = await import('$lib/playground/nim');
			return new Nim();
		}
	},
	{
		languageId: 'BASH',
		load: async () => {
			const { default: Bash } = await import('$lib/playground/bash');
			return new Bash();
		}
	},
	{
		languageId: 'FORTRAN',
		load: async () => {
			const { default: Fortran } = await import('$lib/playground/fortran');
			return new Fortran();
		}
	},
	{
		languageId: 'COBOL',
		load: async () => {
			const { default: Cobol } = await import('$lib/playground/cobol');
			return new Cobol();
		}
	},
	{
		languageId: 'TINYGO',
		load: async () => {
			const { default: TinyGo } = await import('$lib/playground/tinygo');
			return new TinyGo();
		}
	},
	{
		languageId: 'OCAML',
		load: async () => {
			const { default: Ocaml } = await import('$lib/playground/ocaml');
			return new Ocaml();
		}
	},
	{
		languageId: 'JAVASCRIPT',
		load: async () => {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			return new TypeScriptSandbox('JAVASCRIPT');
		}
	},
	{
		languageId: 'TYPESCRIPT',
		load: async () => {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			return new TypeScriptSandbox('TYPESCRIPT');
		}
	},
	{
		languageId: 'ASSEMBLYSCRIPT',
		load: async () => {
			const { default: AssemblyScript } = await import('$lib/playground/assemblyscript');
			return new AssemblyScript();
		}
	},
	{
		languageId: 'WAT',
		load: async () => {
			const { default: Wat } = await import('$lib/playground/wat');
			return new Wat();
		}
	},
	{
		languageId: 'WASM',
		load: async () => {
			const { default: Wasm } = await import('$lib/playground/wasm');
			return new Wasm();
		}
	},
	{
		languageId: 'LUA',
		load: async () => {
			const { default: Lua } = await import('$lib/playground/lua');
			return new Lua();
		}
	},
	{
		languageId: 'ZIG',
		load: async () => {
			const { default: Zig } = await import('$lib/playground/zig');
			return new Zig();
		}
	},
	{
		languageId: 'LISP',
		load: async () => {
			const { default: Lisp } = await import('$lib/playground/lisp');
			return new Lisp();
		}
	},
	{
		languageId: 'RUBY',
		load: async () => {
			const { default: Ruby } = await import('$lib/playground/ruby');
			return new Ruby();
		}
	},
	{
		languageId: 'HASKELL',
		load: async () => {
			const { default: Haskell } = await import('$lib/playground/haskell');
			return new Haskell();
		}
	},
	{
		languageId: 'R',
		load: async () => {
			const { default: R } = await import('$lib/playground/r');
			return new R();
		}
	},
	{
		languageId: 'OCTAVE',
		load: async () => {
			const { default: Octave } = await import('$lib/playground/octave');
			return new Octave();
		}
	},
	{
		languageId: 'DUCKDB',
		load: async () => {
			const { default: DuckDB } = await import('$lib/playground/duckdb');
			return new DuckDB();
		}
	},
	{
		languageId: 'SQLITE',
		load: async () => {
			const { default: Sqlite } = await import('$lib/playground/sqlite');
			return new Sqlite();
		}
	},
	{
		languageId: 'PHP',
		load: async () => {
			const { default: Php } = await import('$lib/playground/php');
			return new Php();
		}
	}
] satisfies SandboxRoute[];

const sandboxRouteByLanguage = new Map<CanonicalLanguageId, SandboxRoute>();
for (const route of sandboxRoutes) {
	if (sandboxRouteByLanguage.has(route.languageId)) {
		throw new Error(`Duplicate sandbox route: ${route.languageId}`);
	}
	sandboxRouteByLanguage.set(route.languageId, route);
}
for (const languageId of supportedLanguageIds) {
	if (!sandboxRouteByLanguage.has(languageId)) {
		throw new Error(`Missing sandbox route: ${languageId}`);
	}
}

export const supportedLanguages = [...supportedLanguageIds];

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
	const normalizedLanguage = normalizeLanguageId(language);
	if (!isSupportedLanguageId(normalizedLanguage)) {
		throw new Error(`Unsupported language: ${language}`);
	}
	const route = sandboxRouteByLanguage.get(normalizedLanguage);
	if (!route) throw new Error(`Missing sandbox route: ${normalizedLanguage}`);
	return runtimeAssets
		? createPlaygroundBinding(runtimeAssets).load(normalizedLanguage)
		: route.load();
}

export default playground;
