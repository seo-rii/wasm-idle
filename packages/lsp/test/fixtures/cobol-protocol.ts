export const cobolFixtureFiles = {
	'superbol.toml': '[cobol]\ndialect = "cobol85"\nsource-format = "fixed"\n',
	'greeting.cpy': '       01 GREETING PIC X(5) VALUE "HELLO".\n',
	'main.cob':
		'       IDENTIFICATION DIVISION.\n       PROGRAM-ID. HELLO.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n           COPY "greeting.cpy".\n       PROCEDURE DIVISION.\n       MAIN-PARAGRAPH.\n           DISPLAY GREETING.\n           PERFORM DONE-PARAGRAPH.\n       DONE-PARAGRAPH.\n           STOP RUN.\n'
};
export interface CobolTestClient {
	request(method: string, params: unknown): Promise<any>;
	notify(method: string, params: unknown): Promise<void>;
	diagnostics: any[];
}

/** Exactly the same source/requests exercise the original CLI and browser adapter. */
export async function exerciseCobolProtocol(
	client: CobolTestClient,
	rootUri: string,
	{ expectDiagnostics = true } = {}
) {
	const uri = `${rootUri}/main.cob`;
	const waitFor = async (predicate: () => any) => {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const value = predicate();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		throw new Error(`COBOL diagnostics timed out: ${JSON.stringify(client.diagnostics)}`);
	};
	const initialized = await client.request('initialize', {
		processId: null,
		rootUri,
		capabilities: {}
	});
	await client.notify('initialized', {});
	await client.notify('textDocument/didOpen', {
		textDocument: {
			uri,
			languageId: 'cobol',
			version: 1,
			text: expectDiagnostics
				? cobolFixtureFiles['main.cob'].replace('DISPLAY GREETING.', 'DISPLAY "BROKEN.')
				: cobolFixtureFiles['main.cob']
		}
	});
	let invalid: any[] = [];
	let corrected: any[] = [];
	if (expectDiagnostics) {
		invalid = (
			await waitFor(() =>
				client.diagnostics.find((entry) => entry.uri === uri && entry.diagnostics.length)
			)
		).diagnostics;
		const previous = client.diagnostics.length;
		await client.notify('textDocument/didChange', {
			textDocument: { uri, version: 2 },
			contentChanges: [
				{
					range: { start: { line: 7, character: 11 }, end: { line: 7, character: 27 } },
					text: 'DISPLAY GREETING.'
				}
			]
		});
		corrected = (
			await waitFor(() =>
				client.diagnostics
					.slice(previous)
					.find((entry) => entry.uri === uri && !entry.diagnostics.length)
			)
		).diagnostics;
	}
	const document = { textDocument: { uri } };
	const position = { line: 7, character: 21 };
	const completion = await client.request('textDocument/completion', {
		...document,
		position: { line: 7, character: 22 }
	});
	const hover = await client.request('textDocument/hover', { ...document, position });
	const definition = await client.request('textDocument/definition', { ...document, position });
	const references = await client.request('textDocument/references', {
		...document,
		position,
		context: { includeDeclaration: true }
	});
	const rename = await client.request('textDocument/rename', {
		...document,
		position: { line: 8, character: 23 },
		newName: 'FINISH-PARAGRAPH'
	});
	const symbols = await client.request('textDocument/documentSymbol', document);
	return {
		capabilities: initialized.capabilities,
		serverInfo: initialized.serverInfo,
		invalid,
		corrected,
		completion: completion.items.filter((item: any) => item.label === 'GREETING'),
		hover,
		definition,
		references,
		rename,
		symbols
	};
}
