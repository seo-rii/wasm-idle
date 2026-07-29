import { getAssemblyScriptLanguageServer } from './assemblyscript/server.js';
import { getCppLanguageServer } from './clangd/server.js';
import { getDLanguageServer } from './d/server.js';
import {
	getCssLanguageServer,
	getHtmlLanguageServer,
	getJsonLanguageServer,
	getMarkdownLanguageServer,
	getTomlLanguageServer,
	getYamlLanguageServer
} from './document/server.js';
import {
	getCSharpLanguageServer,
	getFSharpLanguageServer,
	getVisualBasicLanguageServer
} from './dotnet/server.js';
import { getElixirLanguageServer } from './elixir/server.js';
import { getErlangLanguageServer } from './erlang/server.js';
import { getFortranLanguageServer } from './fortran/server.js';
import { getGleamLanguageServer } from './gleam/server.js';
import { getGoLanguageServer } from './go/server.js';
import { getGraphqlLanguageServer } from './graphql/server.js';
import { getHaskellLanguageServer } from './haskell/server.js';
import { getJanetLanguageServer } from './janet/server.js';
import { getLispLanguageServer } from './lisp/server.js';
import { getLuaLanguageServer } from './lua/server.js';
import { getOcamlLanguageServer } from './ocaml/server.js';
import { getOctaveLanguageServer } from './octave/server.js';
import { getPascalLanguageServer } from './pascal/server.js';
import { getPerlLanguageServer } from './perl/server.js';
import { getPrologLanguageServer } from './prolog/server.js';
import { getPythonLanguageServer } from './python/server.js';
import { getRLanguageServer } from './r/server.js';
import { getRubyLanguageServer } from './ruby/server.js';
import { getRustLanguageServer } from './rust/server.js';
import { getDuckDbLanguageServer, getSqlLanguageServer } from './sql/server.js';
import { getTclLanguageServer } from './tcl/server.js';
import type { EditorLanguageServerHandle, EditorLanguageServerOptions } from './types.js';
import { getJavaScriptLanguageServer, getTypeScriptLanguageServer } from './typescript/server.js';
import { getWasmLanguageServer } from './wasm/server.js';
import { getWatLanguageServer } from './wat/server.js';
import { getZigLanguageServer } from './zig/server.js';
import { getAwkLanguageServer } from './awk/server.js';

export type EditorLanguageServerProviderFactory = (
	options?: EditorLanguageServerOptions
) => Promise<EditorLanguageServerHandle>;

export interface EditorLanguageServerProviderDescriptor {
	readonly id: string;
	readonly languages: readonly string[];
	readonly create: EditorLanguageServerProviderFactory;
}

const providerDefinitions = [
	{
		id: 'clangd',
		languages: ['c', 'cpp'],
		create: (options) => getCppLanguageServer(options)
	},
	{
		id: 'python',
		languages: ['python'],
		create: (options) => getPythonLanguageServer(options)
	},
	{
		id: 'rust',
		languages: ['rust', 'rs'],
		create: (options) => getRustLanguageServer(options)
	},
	{
		id: 'go',
		languages: ['go', 'golang'],
		create: (options) => getGoLanguageServer(options)
	},
	{
		id: 'd',
		languages: ['d'],
		create: (options) => getDLanguageServer(options)
	},
	{
		id: 'tcl',
		languages: ['tcl', 'tclsh'],
		create: (options) => getTclLanguageServer(options)
	},
	{
		id: 'pascal',
		languages: ['pascal', 'pas', 'fpc'],
		create: (options) => getPascalLanguageServer(options)
	},
	{
		id: 'gleam',
		languages: ['gleam'],
		create: (options) => getGleamLanguageServer(options)
	},
	{
		id: 'elixir',
		languages: ['elixir', 'ex', 'exs'],
		create: (options) => getElixirLanguageServer(options)
	},
	{
		id: 'erlang',
		languages: ['erlang', 'erl', 'hrl'],
		create: (options) => getErlangLanguageServer(options)
	},
	{
		id: 'typescript',
		languages: ['typescript', 'ts'],
		create: (options) => getTypeScriptLanguageServer(options)
	},
	{
		id: 'javascript',
		languages: ['javascript', 'js'],
		create: (options) => getJavaScriptLanguageServer(options)
	},
	{
		id: 'wat',
		languages: ['wat', 'webassembly'],
		create: (options) => getWatLanguageServer(options)
	},
	{
		id: 'wasm',
		languages: ['wasm', 'wasm32', 'webassembly-binary'],
		create: (options) => getWasmLanguageServer(options)
	},
	{
		id: 'dotnet-csharp',
		languages: ['csharp', 'c#', 'cs'],
		create: (options) => getCSharpLanguageServer(options)
	},
	{
		id: 'dotnet-fsharp',
		languages: ['fsharp', 'f#', 'fs'],
		create: (options) => getFSharpLanguageServer(options)
	},
	{
		id: 'dotnet-visual-basic',
		languages: ['vb', 'vbnet', 'visualbasic', 'visual-basic'],
		create: (options) => getVisualBasicLanguageServer(options)
	},
	{
		id: 'assemblyscript',
		languages: ['assemblyscript', 'as'],
		create: (options) => getAssemblyScriptLanguageServer(options)
	},
	{
		id: 'zig',
		languages: ['zig'],
		create: (options) => getZigLanguageServer(options)
	},
	{
		id: 'lua',
		languages: ['lua'],
		create: (options) => getLuaLanguageServer(options)
	},
	{
		id: 'janet',
		languages: ['janet'],
		create: (options) => getJanetLanguageServer(options)
	},
	{
		id: 'lisp',
		languages: ['lisp', 'scheme', 'scm'],
		create: (options) => getLispLanguageServer(options)
	},
	{
		id: 'octave',
		languages: ['octave', 'matlab', 'm'],
		create: (options) => getOctaveLanguageServer(options)
	},
	{
		id: 'ocaml',
		languages: ['ocaml', 'ml'],
		create: (options) => getOcamlLanguageServer(options)
	},
	{
		id: 'haskell',
		languages: ['haskell', 'hs'],
		create: (options) => getHaskellLanguageServer(options)
	},
	{
		id: 'sql',
		languages: ['sql', 'sqlite'],
		create: (options) => getSqlLanguageServer(options)
	},
	{
		id: 'duckdb',
		languages: ['duckdb'],
		create: (options) => getDuckDbLanguageServer(options)
	},
	{
		id: 'graphql',
		languages: ['graphql', 'gql'],
		create: (options) => getGraphqlLanguageServer(options)
	},
	{
		id: 'fortran',
		languages: ['fortran', 'f90', 'f95'],
		create: (options) => getFortranLanguageServer(options)
	},
	{
		id: 'prolog',
		languages: ['prolog', 'swipl'],
		create: (options) => getPrologLanguageServer(options)
	},
	{
		id: 'ruby',
		languages: ['ruby', 'rb'],
		create: (options) => getRubyLanguageServer(options)
	},
	{
		id: 'r',
		languages: ['r'],
		create: (options) => getRLanguageServer(options)
	},
	{
		id: 'awk',
		languages: ['awk', 'gawk'],
		create: (options) => getAwkLanguageServer(options)
	},
	{
		id: 'perl',
		languages: ['perl', 'pl'],
		create: (options) => getPerlLanguageServer(options)
	},
	{
		id: 'document-json',
		languages: ['json', 'jsonc'],
		create: (options) => getJsonLanguageServer(options)
	},
	{
		id: 'document-yaml',
		languages: ['yaml', 'yml'],
		create: (options) => getYamlLanguageServer(options)
	},
	{
		id: 'document-toml',
		languages: ['toml'],
		create: (options) => getTomlLanguageServer(options)
	},
	{
		id: 'document-html',
		languages: ['html', 'htm'],
		create: (options) => getHtmlLanguageServer(options)
	},
	{
		id: 'document-css',
		languages: ['css'],
		create: (options) => getCssLanguageServer(options)
	},
	{
		id: 'document-markdown',
		languages: ['markdown', 'md'],
		create: (options) => getMarkdownLanguageServer(options)
	}
] satisfies readonly EditorLanguageServerProviderDescriptor[];

export const editorLanguageServerProviders: readonly EditorLanguageServerProviderDescriptor[] =
	Object.freeze(
		providerDefinitions.map((provider) =>
			Object.freeze({
				...provider,
				languages: Object.freeze([...provider.languages])
			})
		)
	);

const providerByLanguage = new Map<string, EditorLanguageServerProviderDescriptor>();

for (const provider of editorLanguageServerProviders) {
	for (const language of provider.languages) {
		if (language !== language.toLowerCase() || language.trim() !== language) {
			throw new Error(`Invalid language server registry alias: ${language}`);
		}
		if (providerByLanguage.has(language)) {
			throw new Error(`Duplicate language server registry alias: ${language}`);
		}
		providerByLanguage.set(language, provider);
	}
}

export function resolveEditorLanguageServerProvider(
	language: string
): EditorLanguageServerProviderDescriptor | undefined {
	return providerByLanguage.get(language.trim().toLowerCase());
}

export async function getEditorLanguageServer(
	language: string,
	options?: EditorLanguageServerOptions
): Promise<EditorLanguageServerHandle | null> {
	const provider = resolveEditorLanguageServerProvider(language);
	return provider ? await provider.create(options) : null;
}
