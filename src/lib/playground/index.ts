import type {
	BoundSandbox,
	PlaygroundBinding,
	Sandbox,
	SandboxRuntimeAssets
} from '$lib/playground/sandbox';
import { createPlaygroundBinding as createCorePlaygroundBinding } from '@wasm-idle/core';

const sandboxCache: { [key: string]: Sandbox } = {};

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
	'OCTAVE',
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
	let sandbox: Sandbox;
	switch (language) {
		case 'PYTHON3':
		case 'PYTHON':
		case 'PYPY3': {
			const { default: Python } = await import('$lib/playground/python');
			sandbox = new Python();
			break;
		}
		case 'C': {
			const { default: Clang } = await import('$lib/playground/clang');
			sandbox = new Clang('C');
			break;
		}
		case 'CPP': {
			const { default: Clang } = await import('$lib/playground/clang');
			sandbox = new Clang('CPP');
			break;
		}
		case 'JAVA': {
			const { default: Java } = await import('$lib/playground/java');
			sandbox = new Java();
			break;
		}
		case 'RUST': {
			const { default: Rust } = await import('$lib/playground/rust');
			sandbox = new Rust();
			break;
		}
		case 'GO': {
			const { default: Go } = await import('$lib/playground/go');
			sandbox = new Go();
			break;
		}
		case 'D':
		case 'DLANG': {
			const { default: D } = await import('$lib/playground/d');
			sandbox = new D();
			break;
		}
		case 'CSHARP':
		case 'C#': {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			sandbox = new Dotnet('CSHARP');
			break;
		}
		case 'FSHARP':
		case 'F#': {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			sandbox = new Dotnet('FSHARP');
			break;
		}
		case 'VBNET':
		case 'VB':
		case 'VISUALBASIC': {
			const { default: Dotnet } = await import('$lib/playground/dotnet');
			sandbox = new Dotnet('VBNET');
			break;
		}
		case 'ELIXIR': {
			const { default: Elixir } = await import('$lib/playground/elixir');
			sandbox = new Elixir();
			break;
		}
		case 'ERLANG':
		case 'ERL': {
			const { default: Elixir } = await import('$lib/playground/elixir');
			sandbox = new Elixir('ERLANG');
			break;
		}
		case 'PROLOG':
		case 'SWIPL':
		case 'SWI': {
			const { default: Prolog } = await import('$lib/playground/prolog');
			sandbox = new Prolog();
			break;
		}
		case 'GLEAM': {
			const { default: Gleam } = await import('$lib/playground/gleam');
			sandbox = new Gleam();
			break;
		}
		case 'PERL': {
			const { default: Perl } = await import('$lib/playground/perl');
			sandbox = new Perl();
			break;
		}
		case 'TCL':
		case 'TCLSH': {
			const { default: Tcl } = await import('$lib/playground/tcl');
			sandbox = new Tcl();
			break;
		}
		case 'AWK':
		case 'GAWK': {
			const { default: Awk } = await import('$lib/playground/awk');
			sandbox = new Awk();
			break;
		}
		case 'TINYGO': {
			const { default: TinyGo } = await import('$lib/playground/tinygo');
			sandbox = new TinyGo();
			break;
		}
		case 'OCAML': {
			const { default: Ocaml } = await import('$lib/playground/ocaml');
			sandbox = new Ocaml();
			break;
		}
		case 'JAVASCRIPT':
		case 'JS': {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			sandbox = new TypeScriptSandbox('JAVASCRIPT');
			break;
		}
		case 'TYPESCRIPT':
		case 'TS': {
			const { default: TypeScriptSandbox } = await import('$lib/playground/typescript');
			sandbox = new TypeScriptSandbox('TYPESCRIPT');
			break;
		}
		case 'ASSEMBLYSCRIPT':
		case 'AS': {
			const { default: AssemblyScript } = await import('$lib/playground/assemblyscript');
			sandbox = new AssemblyScript();
			break;
		}
		case 'WAT': {
			const { default: Wat } = await import('$lib/playground/wat');
			sandbox = new Wat();
			break;
		}
		case 'LUA': {
			const { default: Lua } = await import('$lib/playground/lua');
			sandbox = new Lua();
			break;
		}
		case 'ZIG': {
			const { default: Zig } = await import('$lib/playground/zig');
			sandbox = new Zig();
			break;
		}
		case 'LISP':
		case 'SCHEME':
		case 'SCM': {
			const { default: Lisp } = await import('$lib/playground/lisp');
			sandbox = new Lisp();
			break;
		}
		case 'RUBY':
		case 'RB': {
			const { default: Ruby } = await import('$lib/playground/ruby');
			sandbox = new Ruby();
			break;
		}
		case 'HASKELL':
		case 'HS': {
			const { default: Haskell } = await import('$lib/playground/haskell');
			sandbox = new Haskell();
			break;
		}
		case 'R': {
			const { default: R } = await import('$lib/playground/r');
			sandbox = new R();
			break;
		}
		case 'OCTAVE':
		case 'MATLAB': {
			const { default: Octave } = await import('$lib/playground/octave');
			sandbox = new Octave();
			break;
		}
		case 'SQLITE':
		case 'SQL': {
			const { default: Sqlite } = await import('$lib/playground/sqlite');
			sandbox = new Sqlite();
			break;
		}
		case 'PHP': {
			const { default: Php } = await import('$lib/playground/php');
			sandbox = new Php();
			break;
		}
		default:
			throw new Error(`Unsupported language: ${language}`);
	}
	sandboxCache[language] = sandbox;
	if (sandbox) {
		if (language === 'PYTHON3') sandboxCache['PYPY3'] = sandboxCache['PYTHON'] = sandbox;
		if (language === 'PYTHON') sandboxCache['PYTHON3'] = sandboxCache['PYPY3'] = sandbox;
		if (language === 'PYPY3') sandboxCache['PYTHON3'] = sandboxCache['PYTHON'] = sandbox;
		if (language === 'C') sandboxCache['C'] = sandbox;
		if (language === 'CPP') sandboxCache['CPP'] = sandbox;
		if (language === 'JAVA') sandboxCache['JAVA'] = sandbox;
		if (language === 'RUST') sandboxCache['RUST'] = sandbox;
		if (language === 'GO') sandboxCache['GO'] = sandbox;
		if (language === 'D' || language === 'DLANG') {
			sandboxCache['D'] = sandboxCache['DLANG'] = sandbox;
		}
		if (language === 'CSHARP' || language === 'C#') {
			sandboxCache['CSHARP'] = sandboxCache['C#'] = sandbox;
		}
		if (language === 'FSHARP' || language === 'F#') {
			sandboxCache['FSHARP'] = sandboxCache['F#'] = sandbox;
		}
		if (language === 'VBNET' || language === 'VB' || language === 'VISUALBASIC') {
			sandboxCache['VBNET'] = sandboxCache['VB'] = sandboxCache['VISUALBASIC'] = sandbox;
		}
		if (language === 'ELIXIR') sandboxCache['ELIXIR'] = sandbox;
		if (language === 'ERLANG' || language === 'ERL') {
			sandboxCache['ERLANG'] = sandboxCache['ERL'] = sandbox;
		}
		if (language === 'PROLOG' || language === 'SWIPL' || language === 'SWI') {
			sandboxCache['PROLOG'] = sandboxCache['SWIPL'] = sandboxCache['SWI'] = sandbox;
		}
		if (language === 'GLEAM') sandboxCache['GLEAM'] = sandbox;
		if (language === 'PERL') sandboxCache['PERL'] = sandbox;
		if (language === 'TCL' || language === 'TCLSH') {
			sandboxCache['TCL'] = sandboxCache['TCLSH'] = sandbox;
		}
		if (language === 'AWK' || language === 'GAWK') {
			sandboxCache['AWK'] = sandboxCache['GAWK'] = sandbox;
		}
		if (language === 'TINYGO') sandboxCache['TINYGO'] = sandbox;
		if (language === 'OCAML') sandboxCache['OCAML'] = sandbox;
		if (language === 'JAVASCRIPT' || language === 'JS') {
			sandboxCache['JAVASCRIPT'] = sandboxCache['JS'] = sandbox;
		}
		if (language === 'TYPESCRIPT' || language === 'TS') {
			sandboxCache['TYPESCRIPT'] = sandboxCache['TS'] = sandbox;
		}
		if (language === 'ASSEMBLYSCRIPT' || language === 'AS') {
			sandboxCache['ASSEMBLYSCRIPT'] = sandboxCache['AS'] = sandbox;
		}
		if (language === 'WAT') sandboxCache['WAT'] = sandbox;
		if (language === 'LUA') sandboxCache['LUA'] = sandbox;
		if (language === 'ZIG') sandboxCache['ZIG'] = sandbox;
		if (language === 'LISP' || language === 'SCHEME' || language === 'SCM') {
			sandboxCache['LISP'] = sandboxCache['SCHEME'] = sandboxCache['SCM'] = sandbox;
		}
		if (language === 'RUBY' || language === 'RB') {
			sandboxCache['RUBY'] = sandboxCache['RB'] = sandbox;
		}
		if (language === 'HASKELL' || language === 'HS') {
			sandboxCache['HASKELL'] = sandboxCache['HS'] = sandbox;
		}
		if (language === 'R') sandboxCache['R'] = sandbox;
		if (language === 'OCTAVE' || language === 'MATLAB') {
			sandboxCache['OCTAVE'] = sandboxCache['MATLAB'] = sandbox;
		}
		if (language === 'SQLITE' || language === 'SQL') {
			sandboxCache['SQLITE'] = sandboxCache['SQL'] = sandbox;
		}
		if (language === 'PHP') sandboxCache['PHP'] = sandbox;
	}
	return runtimeAssets ? createPlaygroundBinding(runtimeAssets).load(language) : sandbox;
}

export default playground;
