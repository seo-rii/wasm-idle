import type { Uri } from 'monaco-editor';

export function createWorkspaceModelUri(uriFactory: Pick<typeof Uri, 'from'>, path: string): Uri {
	// The container path is POSIX on every host, including Windows browsers.
	const uri = uriFactory.from({ scheme: 'file', path: `/workspace/${path}` });
	const serialize = uri.toString.bind(uri);
	// Monaco's native LSP client and @seorii/monaco use toString(true) on model URIs.
	// That normally leaves literal percent escapes unescaped. Keep those wire URIs
	// encoded, including lowercase hex for the client's lowercased didOpen URI.
	const lspUri = serialize().replace(/%[\dA-F]{2}/g, (escape) => escape.toLowerCase());
	// Normal serialization must still match independently created model lookup URIs.
	uri.toString = (skipEncoding = false) => (skipEncoding ? lspUri : serialize());
	return uri;
}
