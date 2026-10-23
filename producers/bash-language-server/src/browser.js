import { initializeParser } from 'bash-language-server/out/parser.js';
import {
	BrowserMessageReader,
	BrowserMessageWriter,
	createConnection
} from 'vscode-languageserver/browser';
import { initializeFiles, writeFileSync } from './platform/fs.js';
import { fileURLToPath } from './platform/url.js';

function browserConfiguration(configuration = {}) {
	if (!configuration || typeof configuration !== 'object') configuration = {};
	return {
		...configuration,
		shellcheckPath: '',
		shfmt: { ...configuration.shfmt, path: '' },
		explainshellEndpoint: '',
		enableSourceErrorDiagnostics: true
	};
}

/** Only transport, virtual files and unavailable external commands differ from upstream. */
export async function startBashLanguageServer({ scope = globalThis, files = {} } = {}) {
	const [grammar, ini] = await Promise.all(
		['tree-sitter-bash.wasm', 'one_ini_bg.wasm'].map(async (name) => {
			const response = await fetch(new URL(name, import.meta.url));
			if (!response.ok)
				throw new Error(
					`Bash language-server asset request failed (${response.status}): ${name}`
				);
			return new Uint8Array(await response.arrayBuffer());
		})
	);
	initializeFiles(files, grammar, ini);
	// Validate the original parser and grammar before announcing worker readiness.
	const warmParser = await initializeParser();
	warmParser.delete();
	// The unmodified editorconfig dependency synchronously initializes its INI Wasm.
	// Load the original server after supplying that binary through the virtual FS.
	const { default: BashServerModule } = await import('bash-language-server');
	const BashServer = BashServerModule.default || BashServerModule;
	const connection = createConnection(
		new BrowserMessageReader(scope),
		new BrowserMessageWriter(scope)
	);
	const registerConfiguration = connection.onDidChangeConfiguration.bind(connection);
	connection.onDidChangeConfiguration = (handler) =>
		registerConfiguration((params) =>
			handler({
				...params,
				settings: {
					...params.settings,
					bashIde: browserConfiguration(params.settings?.bashIde)
				}
			})
		);
	const getConfiguration = connection.workspace.getConfiguration.bind(connection.workspace);
	connection.workspace.getConfiguration = async (...args) => {
		const configuration = await getConfiguration(...args);
		return Array.isArray(configuration)
			? configuration.map(browserConfiguration)
			: browserConfiguration(configuration);
	};
	connection.onInitialize(async (params) => {
		const server = await BashServer.initialize(connection, {
			...params,
			initializationOptions: browserConfiguration(params.initializationOptions)
		});
		// Mirror open document content before upstream analyzes source relationships.
		server.documents.onDidChangeContent(({ document }) => {
			writeFileSync(fileURLToPath(document.uri), document.getText());
		});
		server.register(connection);
		return {
			capabilities: { ...server.capabilities(), documentFormattingProvider: false },
			serverInfo: { name: 'bash-language-server', version: '5.8.1' }
		};
	});
	connection.listen();
}
