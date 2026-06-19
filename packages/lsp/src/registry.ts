import { getAssemblyScriptLanguageServer } from './assemblyscript/server.js';
import { getCppLanguageServer } from './clangd/server.js';
import {
	getCSharpLanguageServer,
	getFSharpLanguageServer,
	getVisualBasicLanguageServer
} from './dotnet/server.js';
import { getGleamLanguageServer } from './gleam/server.js';
import { getGoLanguageServer } from './go/server.js';
import { getPythonLanguageServer } from './python/server.js';
import { getRustLanguageServer } from './rust/server.js';
import { getJavaScriptLanguageServer, getTypeScriptLanguageServer } from './typescript/server.js';
import type { EditorLanguageServerHandle, EditorLanguageServerOptions } from './types.js';
import { getWatLanguageServer } from './wat/server.js';
import { getZigLanguageServer } from './zig/server.js';
import { getPhpLanguageServer } from './php/server.js';
import { getLuaLanguageServer } from './lua/server.js';
import { getOcamlLanguageServer } from './ocaml/server.js';
import { getHaskellLanguageServer } from './haskell/server.js';

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

	if (normalized === 'typescript' || normalized === 'ts') {
		return getTypeScriptLanguageServer(options);
	}

	if (normalized === 'javascript' || normalized === 'js') {
		return getJavaScriptLanguageServer(options);
	}

	if (normalized === 'wat' || normalized === 'webassembly') {
		return getWatLanguageServer(options);
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

	if (normalized === 'ocaml' || normalized === 'ml') {
		return getOcamlLanguageServer(options);
	}

	if (normalized === 'haskell' || normalized === 'hs') {
		return getHaskellLanguageServer(options);
	}

	return null;
}
