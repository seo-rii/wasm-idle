// Platform host only. All parsing and language handlers run in upstream org.javacs.Main.
const LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function startJavaLanguageServerHost() {
	let connected = false;
	addEventListener('message', (event) => {
		if (
			connected ||
			event.source !== parent ||
			event.data?.type !== 'wasm-idle-java-lsp-connect' ||
			event.ports.length !== 1
		)
			return;
		connected = true;
		const port = event.ports[0];
		let started = false;
		let bridge;
		let rootUri = 'file:///workspace';
		const canonicalUris = new Map();
		let initialFiles = [];
		const sessionRoot = `/files/java-lsp-${crypto.randomUUID()}/workspace`;
		const virtualUri = `file://${sessionRoot}`;
		const queue = [];
		let waiting;
		let ready;
		const platformReady = new Promise((resolve) => {
			ready = resolve;
		});
		let inbound = Promise.resolve();
		let stdout = new Uint8Array();
		let stderrTail = '';
		const files = new Map();
		const send = (message) => port.postMessage(message);
		const describeError = async (error) => {
			try {
				return error instanceof Error
					? error.stack || error.message
					: await error.toString();
			} catch {
				return 'Java host error could not be rendered';
			}
		};
		const fail = async (error) => send({ type: 'error', message: await describeError(error) });
		const canonicalUri = (value) =>
			value.startsWith('file:')
				? canonicalUris.get(new URL(value).href.toLowerCase()) || value
				: value;
		const mapUri = (input, from, to) => {
			const value = canonicalUri(input);
			return value === from
				? to
				: value.startsWith(`${from}/`)
					? `${to}${value.slice(from.length)}`
					: value;
		};
		const rewrite = (value, from, to) => {
			if (typeof value === 'string') return mapUri(value, from, to);
			if (Array.isArray(value)) return value.map((item) => rewrite(item, from, to));
			if (value && typeof value === 'object')
				return Object.fromEntries(
					Object.entries(value).map(([key, item]) => [
						mapUri(key, from, to),
						rewrite(item, from, to)
					])
				);
			return value;
		};
		const pathFor = (uri) => {
			const url = new URL(uri);
			const filename = decodeURIComponent(url.pathname);
			if (
				url.protocol !== 'file:' ||
				!filename.startsWith(`${sessionRoot}/`) ||
				filename.includes('\0') ||
				filename.split('/').some((part) => part === '..' || part === '.')
			)
				throw new Error('Java document is outside the workspace');
			return filename;
		};
		const offsetAt = (text, position) => {
			let offset = 0;
			for (let line = 0; line < position.line; line++) {
				const next = text.indexOf('\n', offset);
				if (next < 0) return text.length;
				offset = next + 1;
			}
			const end = text.indexOf('\n', offset);
			return Math.min(offset + position.character, end < 0 ? text.length : end);
		};
		const enqueue = (message) => {
			const json = JSON.stringify(message);
			const chunk = `Content-Length: ${encoder.encode(json).byteLength}\r\n\r\n${json}`;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve(chunk);
			} else queue.push(chunk);
		};
		const mirrorFile = async (uri, text, type) => {
			await bridge.writeFile(pathFor(uri), text);
			// A browser editor creates files after initialize. Report each actual VFS
			// write through the upstream server's standard file-watcher handler.
			enqueue({
				jsonrpc: '2.0',
				method: 'workspace/didChangeWatchedFiles',
				params: { changes: [{ uri, type }] }
			});
		};
		const forward = async (original) => {
			await platformReady;
			if (original.method === 'initialize') {
				const candidate =
					typeof original.params?.rootUri === 'string'
						? canonicalUri(original.params.rootUri)
						: undefined;
				if (typeof candidate === 'string' && candidate.startsWith('file:///'))
					rootUri = candidate.replace(/\/$/, '');
			}
			const message = rewrite(original, rootUri, virtualUri);
			if (message.method === 'initialize') {
				message.params ||= {};
				message.params.rootUri = virtualUri;
				message.params.rootPath = sessionRoot;
				message.params.workspaceFolders = [{ uri: virtualUri, name: 'java-workspace' }];
				// Native clients can ask for symbols/code actions before didOpen.
				// Make the editor's exact snapshot real files before upstream scans roots.
				for (const [uri, text] of initialFiles)
					await bridge.writeFile(pathFor(mapUri(uri, rootUri, virtualUri)), text);
				initialFiles = [];
			}
			if (message.method === 'textDocument/didOpen') {
				const document = message.params.textDocument;
				const type = files.has(document.uri) ? 2 : 1;
				files.set(document.uri, document.text);
				await mirrorFile(document.uri, document.text, type);
			} else if (message.method === 'textDocument/didChange') {
				const uri = message.params.textDocument.uri;
				let text = files.get(uri);
				if (typeof text !== 'string')
					throw new Error('Java didChange requires an open document');
				for (const change of message.params.contentChanges)
					text = change.range
						? text.slice(0, offsetAt(text, change.range.start)) +
							change.text +
							text.slice(offsetAt(text, change.range.end))
						: change.text;
				files.set(uri, text);
				await mirrorFile(uri, text, 2);
			} else if (message.method === 'textDocument/didClose')
				files.delete(message.params.textDocument.uri);
			enqueue(message);
		};
		const write = (chunk, stderr) => {
			if (stderr) {
				stderrTail = (stderrTail + chunk).slice(-16384);
				return;
			}
			const next = Uint8Array.from(chunk, (character) => character.charCodeAt(0) & 255);
			const combined = new Uint8Array(stdout.length + next.length);
			combined.set(stdout);
			combined.set(next, stdout.length);
			stdout = combined;
			for (;;) {
				let end = -1;
				for (let i = 0; i + 3 < stdout.length; i++)
					if (
						stdout[i] === 13 &&
						stdout[i + 1] === 10 &&
						stdout[i + 2] === 13 &&
						stdout[i + 3] === 10
					) {
						end = i;
						break;
					}
				if (end < 0) {
					if (stdout.length > 16384) throw new Error('Java LSP header exceeds its limit');
					return;
				}
				const match = /Content-Length:\s*(\d+)/i.exec(
					decoder.decode(stdout.subarray(0, end))
				);
				if (!match) throw new Error('Original Java LSP sent an invalid frame');
				const length = Number(match[1]);
				if (!Number.isSafeInteger(length) || length > 16 * 1024 * 1024)
					throw new Error('Original Java LSP message exceeds its limit');
				if (stdout.length < end + 4 + length) return;
				const message = JSON.parse(
					decoder.decode(stdout.subarray(end + 4, end + 4 + length))
				);
				stdout = stdout.slice(end + 4 + length);
				send(rewrite(message, virtualUri, rootUri));
			}
		};
		const start = async (config) => {
			if (started) throw new Error('Java host can only start once');
			started = true;
			if (!Array.isArray(config.assets) || config.assets.length !== 5)
				throw new Error('Java host requires verified JAR assets');
			initialFiles = Object.entries(config.initialFiles || {});
			for (const [value, text] of initialFiles) {
				let uri = new URL(value);
				if (
					uri.protocol !== 'file:' ||
					uri.hostname ||
					uri.search ||
					uri.hash ||
					typeof text !== 'string'
				)
					throw new Error('Invalid initial Java file');
				while (uri.pathname !== '/') {
					canonicalUris.set(uri.href.toLowerCase(), uri.href);
					uri = new URL('.', uri);
					if (uri.pathname.endsWith('/') && uri.pathname !== '/')
						uri.pathname = uri.pathname.slice(0, -1);
				}
			}
			const originalCreate = Document.prototype.createElement;
			Document.prototype.createElement = function (name, options) {
				const element = originalCreate.call(this, name, options);
				if (name.toLowerCase() === 'iframe') element.credentialless = true;
				return element;
			};
			send({ type: 'progress', stage: 'java-runtime' });
			const script = document.createElement('script');
			script.src = LOADER;
			await new Promise((resolve, reject) => {
				script.onload = resolve;
				script.onerror = () => reject(new Error('Cannot load the CheerpJ 4.3 CDN runtime'));
				document.head.append(script);
			});
			await cheerpjInit({
				version: 17,
				status: 'none',
				...(config.licenseKey ? { licenseKey: config.licenseKey } : {}),
				natives: {
					Java_org_wasmidle_jdtls_BrowserStreams_readChunk() {
						return queue.length
							? queue.shift()
							: new Promise((resolve) => {
									waiting = resolve;
								});
					},
					Java_org_wasmidle_jdtls_BrowserStreams_writeChunk(_lib, chunk, stderr) {
						return write(chunk, stderr);
					},
					Java_org_wasmidle_jdtls_BrowserStreams_reportPhase(_lib, phase) {
						if (phase === 'java-main') send({ type: 'progress', stage: 'java-server' });
						if (phase === 'compiler:com.sun.tools.javac.api.JavacTool')
							send({ type: 'ready' });
					}
				}
			});
			const classPath = [];
			for (const asset of config.assets) {
				if (
					!/^(?:server\/)?[\w.-]+\.jar$/.test(asset.path) ||
					!(asset.bytes instanceof Uint8Array)
				)
					throw new Error('Invalid verified Java asset payload');
				const filename = `/str/java-lsp-${asset.path.replaceAll('/', '-')}`;
				cheerpOSAddStringFile(filename, asset.bytes);
				classPath.push(filename);
			}
			const lib = await cheerpjRunLibrary(classPath.join(':'));
			bridge = await lib.org.wasmidle.jdtls.BrowserStreams;
			await bridge.writeFile(`${sessionRoot}/.java-lsp-workspace`, '');
			ready();
			const exit = await cheerpjRunMain(
				'org.wasmidle.jdtls.BrowserStreams',
				classPath.join(':'),
				'--main-class=org.javacs.Main'
			);
			const stderr = new TextDecoder().decode(
				Uint8Array.from(stderrTail, (character) => character.charCodeAt(0) & 255)
			);
			throw new Error(
				`Original javacs exited with status ${exit}${stderr ? `\n${stderr}` : ''}`
			);
		};
		port.onmessage = (event) => {
			if (event.data?.type === 'start') void start(event.data).catch(fail);
			else if (event.data?.jsonrpc === '2.0') {
				inbound = inbound.then(() => forward(event.data));
				void inbound.catch(fail);
			}
		};
		port.start();
	});
}

if (typeof document !== 'undefined' && document.documentElement.dataset.wasmIdleJavaHost === 'true')
	startJavaLanguageServerHost();
