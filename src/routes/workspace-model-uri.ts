import type { Uri } from 'monaco-editor';

export function createWorkspaceModelUri(uriFactory: Pick<typeof Uri, 'from'>, path: string): Uri {
	// The container path is POSIX on every host, including Windows browsers.
	const uri = uriFactory.from({ scheme: 'file', path: `/workspace/${path}` });
	const serialize = uri.toString.bind(uri);
	// Monaco's native LSP client and @seorii/monaco use toString(true) on model URIs.
	// That normally leaves literal percent escapes unescaped. Keep those wire URIs
	// encoded on the wire so literal percent signs and path case survive synchronization.
	uri.toString = () => serialize();
	return uri;
}
