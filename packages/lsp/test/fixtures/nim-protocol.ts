export const nimInvalidSource =
	'import strutils\nproc greeting*(name: string): string =\n  "안녕 " & name.toUpperAscii()\nlet answer: int = "bad"\necho greeting("world"), answer\n';
export const nimValidSource = nimInvalidSource.replace('= "bad"', '= 3');
export const nimHelperSource = 'proc triple*(n: int): int = n * 3\n';
export interface NimTestClient {
	request(method: string, params: unknown): Promise<any>;
	notify(method: string, params: unknown): Promise<void>;
	diagnostics: any[];
}

/** Identical source and standard LSP requests exercise the original CLI and Wasm. */
export async function exerciseNimProtocol(client: NimTestClient, rootUri: string) {
	const uri = `${rootUri}/main.nim`;
	const waitFor = async (predicate: () => any) => {
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const value = predicate();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		throw new Error(`Nim diagnostics timed out: ${JSON.stringify(client.diagnostics)}`);
	};
	const initialize = await client.request('initialize', {
		processId: null,
		rootUri,
		capabilities: {}
	});
	await client.notify('initialized', {});
	await client.notify('textDocument/didOpen', {
		textDocument: { uri, languageId: 'nim', version: 1, text: nimInvalidSource }
	});
	// The original nimlsp publishes diagnostics on save. Its handlers remain unchanged.
	await client.notify('textDocument/didSave', { textDocument: { uri }, text: nimInvalidSource });
	const invalid = await waitFor(() =>
		client.diagnostics.find(
			(data) => data.uri === uri && data.diagnostics.some((item: any) => item.severity === 1)
		)
	);
	const previous = client.diagnostics.length;
	await client.notify('textDocument/didChange', {
		textDocument: { uri, version: 2 },
		contentChanges: [{ text: nimValidSource }]
	});
	await client.notify('textDocument/didSave', { textDocument: { uri }, text: nimValidSource });
	const corrected = await waitFor(() =>
		client.diagnostics
			.slice(previous)
			.find((data) => data.uri === uri && !data.diagnostics.length)
	);
	const doc = { textDocument: { uri } },
		position = { line: 4, character: 8 };
	const completion = await client.request('textDocument/completion', {
		...doc,
		position: { line: 4, character: 7 }
	});
	const hover = await client.request('textDocument/hover', { ...doc, position });
	const definition = await client.request('textDocument/definition', { ...doc, position });
	const references = await client.request('textDocument/references', {
		...doc,
		position,
		context: { includeDeclaration: true }
	});
	const rename = await client.request('textDocument/rename', {
		...doc,
		position,
		newName: 'welcome'
	});
	const signature = await client.request('textDocument/signatureHelp', {
		...doc,
		position: { line: 4, character: 15 }
	});
	const symbols = await client.request('textDocument/documentSymbol', doc);
	const crossFileSource = nimValidSource + 'import helpers\necho helpers.triple(2)\n';
	await client.notify('textDocument/didChange', {
		textDocument: { uri, version: 3 },
		contentChanges: [{ text: crossFileSource }]
	});
	await client.notify('textDocument/didSave', { textDocument: { uri }, text: crossFileSource });
	const crossFileDefinition = await client.request('textDocument/definition', {
		...doc,
		position: { line: 6, character: 15 }
	});
	await client.notify('textDocument/didClose', doc);
	const shutdown = await client.request('shutdown', null);
	await client.notify('exit', null);
	return {
		initialize,
		invalid: invalid.diagnostics,
		corrected: corrected.diagnostics,
		completion: completion.filter((item: any) => item.label === 'greeting'),
		hover,
		definition,
		references,
		rename,
		signature,
		symbols,
		crossFileDefinition,
		shutdown
	};
}
