import Clang from '$lib/playground/clang';
import Dotnet from '$lib/playground/dotnet';
import Elixir from '$lib/playground/elixir';
import Go from '$lib/playground/go';
import Haskell from '$lib/playground/haskell';
import Java from '$lib/playground/java';
import Lisp from '$lib/playground/lisp';
import Lua from '$lib/playground/lua';
import Ocaml from '$lib/playground/ocaml';
import Python from '$lib/playground/python';
import Rust from '$lib/playground/rust';
import TinyGo from '$lib/playground/tinygo';
import TypeScriptSandbox from '$lib/playground/typescript';
import Wat from '$lib/playground/wat';
import Zig from '$lib/playground/zig';
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
	'CSHARP',
	'FSHARP',
	'ELIXIR',
	'TINYGO',
	'OCAML',
	'JAVASCRIPT',
	'TYPESCRIPT',
	'WAT',
	'LUA',
	'ZIG',
	'LISP',
	'HASKELL'
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
	let sandbox;
	switch (language) {
		case 'PYTHON3':
		case 'PYTHON':
		case 'PYPY3':
			sandbox = new Python();
			break;
		case 'C':
			sandbox = new Clang('C');
			break;
		case 'CPP':
			sandbox = new Clang('CPP');
			break;
		case 'JAVA':
			sandbox = new Java();
			break;
		case 'RUST':
			sandbox = new Rust();
			break;
		case 'GO':
			sandbox = new Go();
			break;
		case 'CSHARP':
		case 'C#':
			sandbox = new Dotnet('CSHARP');
			break;
		case 'FSHARP':
		case 'F#':
			sandbox = new Dotnet('FSHARP');
			break;
		case 'ELIXIR':
			sandbox = new Elixir();
			break;
		case 'TINYGO':
			sandbox = new TinyGo();
			break;
		case 'OCAML':
			sandbox = new Ocaml();
			break;
		case 'JAVASCRIPT':
		case 'JS':
			sandbox = new TypeScriptSandbox('JAVASCRIPT');
			break;
		case 'TYPESCRIPT':
		case 'TS':
			sandbox = new TypeScriptSandbox('TYPESCRIPT');
			break;
		case 'WAT':
			sandbox = new Wat();
			break;
		case 'LUA':
			sandbox = new Lua();
			break;
		case 'ZIG':
			sandbox = new Zig();
			break;
		case 'LISP':
		case 'SCHEME':
		case 'SCM':
			sandbox = new Lisp();
			break;
		case 'HASKELL':
		case 'HS':
			sandbox = new Haskell();
			break;
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
		if (language === 'CSHARP' || language === 'C#') {
			sandboxCache['CSHARP'] = sandboxCache['C#'] = sandbox;
		}
		if (language === 'FSHARP' || language === 'F#') {
			sandboxCache['FSHARP'] = sandboxCache['F#'] = sandbox;
		}
		if (language === 'ELIXIR') sandboxCache['ELIXIR'] = sandbox;
		if (language === 'TINYGO') sandboxCache['TINYGO'] = sandbox;
		if (language === 'OCAML') sandboxCache['OCAML'] = sandbox;
		if (language === 'JAVASCRIPT' || language === 'JS') {
			sandboxCache['JAVASCRIPT'] = sandboxCache['JS'] = sandbox;
		}
		if (language === 'TYPESCRIPT' || language === 'TS') {
			sandboxCache['TYPESCRIPT'] = sandboxCache['TS'] = sandbox;
		}
		if (language === 'WAT') sandboxCache['WAT'] = sandbox;
		if (language === 'LUA') sandboxCache['LUA'] = sandbox;
		if (language === 'ZIG') sandboxCache['ZIG'] = sandbox;
		if (language === 'LISP' || language === 'SCHEME' || language === 'SCM') {
			sandboxCache['LISP'] = sandboxCache['SCHEME'] = sandboxCache['SCM'] = sandbox;
		}
		if (language === 'HASKELL' || language === 'HS') {
			sandboxCache['HASKELL'] = sandboxCache['HS'] = sandbox;
		}
	}
	return runtimeAssets ? createPlaygroundBinding(runtimeAssets).load(language) : sandbox;
}

export default playground;
