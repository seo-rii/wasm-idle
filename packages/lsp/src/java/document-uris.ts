import { normalizeJavaFileUri } from './source-uri.js';

export class JavaDocumentUriError extends Error {}

/** Keep Monaco's URI aliases separate from ownership of a newly opened document. */
export class JavaDocumentUris {
	private readonly canonicalUris = new Map<string, string>();
	private readonly openedPaths = new Map<string, string>();

	constructor(initialUris: Readonly<Record<string, string>>) {
		for (const uri of Object.values(initialUris)) {
			const source = normalizeJavaFileUri(uri);
			this.canonicalUris.set(source.pathname.toLowerCase(), source.uri);
		}
	}

	registerOpen(value: string) {
		const source = this.normalize(value);
		if (!source.pathname.startsWith('/workspace/'))
			throw new JavaDocumentUriError('Java source files must be inside file:///workspace/');
		const key = source.pathname.toLowerCase();
		const opened = this.openedPaths.get(key);
		if (opened !== undefined && opened !== source.pathname)
			throw new JavaDocumentUriError(
				`Ambiguous Java didOpen URI: ${source.uri} conflicts with ${this.canonicalUris.get(key)}`
			);
		this.canonicalUris.set(key, this.canonicalUris.get(key) || source.uri);
		// Preserve ownership after didClose: reopening an alias must not replace another file.
		this.openedPaths.set(key, source.pathname);
	}

	canonicalize(value: unknown, key = ''): unknown {
		if (
			typeof value === 'string' &&
			['uri', 'rootUri', 'targetUri', 'oldUri', 'newUri'].includes(key) &&
			/^file:/iu.test(value)
		) {
			const source = this.normalize(value);
			return this.canonicalUris.get(source.pathname.toLowerCase()) || source.uri;
		}
		if (Array.isArray(value)) return value.map((entry) => this.canonicalize(entry));
		if (value && typeof value === 'object')
			return Object.fromEntries(
				Object.entries(value).map(([name, entry]) => [name, this.canonicalize(entry, name)])
			);
		return value;
	}

	private normalize(value: string) {
		try {
			return normalizeJavaFileUri(value);
		} catch (error) {
			throw new JavaDocumentUriError(error instanceof Error ? error.message : String(error));
		}
	}
}
