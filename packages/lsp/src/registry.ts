import { getAssemblyScriptLanguageServer } from './assemblyscript/server.js';
import { getCppLanguageServer } from './clangd/server.js';
import {
	getCSharpLanguageServer,
	getFSharpLanguageServer,
	getVisualBasicLanguageServer
} from './dotnet/server.js';
import { getElixirLanguageServer } from './elixir/server.js';
import { getErlangLanguageServer } from './erlang/server.js';
import { getGleamLanguageServer } from './gleam/server.js';
import { getGoLanguageServer } from './go/server.js';
import { getPythonLanguageServer } from './python/server.js';
import { getRustLanguageServer } from './rust/server.js';
import { getJavaScriptLanguageServer, getTypeScriptLanguageServer } from './typescript/server.js';
import type { EditorLanguageServerHandle, EditorLanguageServerOptions } from './types.js';
import { getWatLanguageServer } from './wat/server.js';
import { getWasmLanguageServer } from './wasm/server.js';
import { getZigLanguageServer } from './zig/server.js';
import { getPhpLanguageServer } from './php/server.js';
import { getLuaLanguageServer } from './lua/server.js';
import { getJanetLanguageServer } from './janet/server.js';
import { getLispLanguageServer } from './lisp/server.js';
import { getOctaveLanguageServer } from './octave/server.js';
import { getOcamlLanguageServer } from './ocaml/server.js';
import { getHaskellLanguageServer } from './haskell/server.js';
import { getFortranLanguageServer } from './fortran/server.js';
import { getGraphqlLanguageServer } from './graphql/server.js';
import { getPrologLanguageServer } from './prolog/server.js';
import { getRubyLanguageServer } from './ruby/server.js';
import { getRLanguageServer } from './r/server.js';
import { getAwkLanguageServer } from './awk/server.js';
import { getPerlLanguageServer } from './perl/server.js';
import { getDuckDbLanguageServer, getSqlLanguageServer } from './sql/server.js';
import {
	getCssLanguageServer,
	getHtmlLanguageServer,
	getJsonLanguageServer,
	getMarkdownLanguageServer,
	getTomlLanguageServer,
	getYamlLanguageServer
} from './document/server.js';

export async function getEditorLanguageServer(
	language: string,
	options?: EditorLanguageServerOptions
): Promise<EditorLanguageServerHandle | null> {
	const normalized = language.toLowerCase();

	if (normalized === 'c' || normalized === 'cpp') {
		return getCppLanguageServer(options);
	}

	if (normalized === 'python') {
		return getPythonLanguageServer(options);
	}

	if (normalized === 'rust' || normalized === 'rs') {
		return getRustLanguageServer(options);
	}

	if (normalized === 'go' || normalized === 'golang') {
		return getGoLanguageServer(options);
	}

	if (normalized === 'gleam') {
		return getGleamLanguageServer(options);
	}

	if (normalized === 'elixir' || normalized === 'ex' || normalized === 'exs') {
		return getElixirLanguageServer(options);
	}

	if (normalized === 'erlang' || normalized === 'erl' || normalized === 'hrl') {
		return getErlangLanguageServer(options);
	}

	if (normalized === 'typescript' || normalized === 'ts') {
		return getTypeScriptLanguageServer(options);
	}

	if (normalized === 'javascript' || normalized === 'js') {
		return getJavaScriptLanguageServer(options);
	}

	if (normalized === 'wat' || normalized === 'webassembly') {
		return getWatLanguageServer(options);
	}

	if (normalized === 'wasm' || normalized === 'wasm32' || normalized === 'webassembly-binary') {
		return getWasmLanguageServer(options);
	}

	if (normalized === 'csharp' || normalized === 'c#' || normalized === 'cs') {
		return getCSharpLanguageServer(options);
	}

	if (normalized === 'fsharp' || normalized === 'f#' || normalized === 'fs') {
		return getFSharpLanguageServer(options);
	}

	if (
		normalized === 'vb' ||
		normalized === 'vbnet' ||
		normalized === 'visualbasic' ||
		normalized === 'visual-basic'
	) {
		return getVisualBasicLanguageServer(options);
	}

	if (normalized === 'assemblyscript' || normalized === 'as') {
		return getAssemblyScriptLanguageServer(options);
	}

	if (normalized === 'zig') {
		return getZigLanguageServer(options);
	}

	if (normalized === 'php') {
		return getPhpLanguageServer(options);
	}

	if (normalized === 'lua') {
		return getLuaLanguageServer(options);
	}

	if (normalized === 'janet') {
		return getJanetLanguageServer(options);
	}

	if (normalized === 'lisp' || normalized === 'scheme' || normalized === 'scm') {
		return getLispLanguageServer(options);
	}

	if (normalized === 'octave' || normalized === 'matlab' || normalized === 'm') {
		return getOctaveLanguageServer(options);
	}

	if (normalized === 'ocaml' || normalized === 'ml') {
		return getOcamlLanguageServer(options);
	}

	if (normalized === 'haskell' || normalized === 'hs') {
		return getHaskellLanguageServer(options);
	}

	if (normalized === 'sql' || normalized === 'sqlite') {
		return getSqlLanguageServer(options);
	}

	if (normalized === 'duckdb') {
		return getDuckDbLanguageServer(options);
	}

	if (normalized === 'graphql' || normalized === 'gql') {
		return getGraphqlLanguageServer(options);
	}

	if (normalized === 'fortran' || normalized === 'f90' || normalized === 'f95') {
		return getFortranLanguageServer(options);
	}

	if (normalized === 'prolog' || normalized === 'swipl') {
		return getPrologLanguageServer(options);
	}

	if (normalized === 'ruby' || normalized === 'rb') {
		return getRubyLanguageServer(options);
	}

	if (normalized === 'r') {
		return getRLanguageServer(options);
	}

	if (normalized === 'awk' || normalized === 'gawk') {
		return getAwkLanguageServer(options);
	}

	if (normalized === 'perl' || normalized === 'pl') {
		return getPerlLanguageServer(options);
	}

	if (normalized === 'json' || normalized === 'jsonc') {
		return getJsonLanguageServer(options);
	}

	if (normalized === 'yaml' || normalized === 'yml') {
		return getYamlLanguageServer(options);
	}

	if (normalized === 'toml') {
		return getTomlLanguageServer(options);
	}

	if (normalized === 'html' || normalized === 'htm') {
		return getHtmlLanguageServer(options);
	}

	if (normalized === 'css') {
		return getCssLanguageServer(options);
	}

	if (normalized === 'markdown' || normalized === 'md') {
		return getMarkdownLanguageServer(options);
	}

	return null;
}
