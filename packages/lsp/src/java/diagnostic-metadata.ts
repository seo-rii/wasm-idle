type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function samePosition(left: unknown, right: unknown) {
	return (
		object(left) &&
		object(right) &&
		typeof left.line === 'number' &&
		typeof left.character === 'number' &&
		left.line === right.line &&
		left.character === right.character
	);
}

function sameDiagnostic(left: JsonObject, right: JsonObject) {
	return (
		typeof left.message === 'string' &&
		left.message === right.message &&
		left.severity === right.severity &&
		object(left.range) &&
		object(right.range) &&
		samePosition(left.range.start, right.range.start) &&
		samePosition(left.range.end, right.range.end)
	);
}

/** Restore fields lost by Monaco's marker-to-codeAction diagnostic conversion. */
export class JavaDiagnosticMetadata {
	private readonly published = new Map<string, JsonObject[]>();

	observe(message: unknown) {
		if (
			!object(message) ||
			message.method !== 'textDocument/publishDiagnostics' ||
			!object(message.params) ||
			typeof message.params.uri !== 'string' ||
			!Array.isArray(message.params.diagnostics)
		)
			return;
		if (message.params.diagnostics.length === 0) this.published.delete(message.params.uri);
		else
			this.published.set(
				message.params.uri,
				structuredClone(message.params.diagnostics.filter(object))
			);
	}

	prepare(message: unknown): unknown {
		if (!object(message) || !object(message.params)) return message;
		const params = message.params;
		const document = params.textDocument;
		if (!object(document) || typeof document.uri !== 'string') return message;
		if (
			['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'].includes(
				String(message.method)
			)
		) {
			this.published.delete(document.uri);
			return message;
		}
		if (
			message.method !== 'textDocument/codeAction' ||
			!object(params.context) ||
			!Array.isArray(params.context.diagnostics)
		)
			return message;
		const originals = this.published.get(document.uri) || [];
		return {
			...message,
			params: {
				...params,
				context: {
					...params.context,
					diagnostics: params.context.diagnostics.flatMap((diagnostic: unknown) => {
						if (!object(diagnostic)) return [diagnostic];
						const matches = originals.filter((original) =>
							sameDiagnostic(original, diagnostic)
						);
						// A delayed or foreign marker has no usable javacs diagnostic code.
						// Keep the actual cursor request, without inventing metadata for it.
						if (matches.length !== 1)
							return diagnostic.code === undefined ? [] : [diagnostic];
						// JSON omits undefined properties; they must not erase an original field.
						const provided = Object.fromEntries(
							Object.entries(diagnostic).filter(([, value]) => value !== undefined)
						);
						return [{ ...matches[0], ...provided }];
					})
				}
			}
		};
	}
}
