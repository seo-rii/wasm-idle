import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const contentTypes = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.wasm', 'application/wasm'],
	['.txt', 'text/plain; charset=utf-8'],
	['.map', 'application/json; charset=utf-8'],
	['.o', 'application/octet-stream'],
	['.rlib', 'application/octet-stream'],
	['.data', 'application/octet-stream']
]);

function applyIsolationHeaders(response) {
	response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
	response.setHeader('Cache-Control', 'no-store');
}

function resolveRequestedPath(requestUrl) {
	const url = new URL(requestUrl, 'http://127.0.0.1');
	const decodedPath = decodeURIComponent(url.pathname);
	const relativePath =
		decodedPath === '/' ? 'browser-harness/index.html' : decodedPath.replace(/^\/+/, '');
	const normalizedPath = relativePath.endsWith('/')
		? `${relativePath}index.html`
		: relativePath;
	const absolutePath = path.resolve(projectRoot, normalizedPath);
	if (!absolutePath.startsWith(projectRoot + path.sep) && absolutePath !== projectRoot) {
		return null;
	}
	return absolutePath;
}

export async function startBrowserHarnessServer({ host = '127.0.0.1', port = 0 } = {}) {
	const server = http.createServer(async (request, response) => {
		applyIsolationHeaders(response);
		if (!request.url) {
			response.writeHead(400);
			response.end('missing request url');
			return;
		}

		const absolutePath = resolveRequestedPath(request.url);
		if (!absolutePath) {
			response.writeHead(403);
			response.end('forbidden');
			return;
		}

		try {
			const stats = await fs.stat(absolutePath);
			const filePath = stats.isDirectory() ? path.join(absolutePath, 'index.html') : absolutePath;
			const body = await fs.readFile(filePath);
			response.writeHead(200, {
				'Content-Type':
					contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
				'Content-Length': body.byteLength
			});
			response.end(body);
		} catch (error) {
			response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			response.end(error instanceof Error ? error.message : 'not found');
		}
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.off('error', reject);
			resolve(undefined);
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('failed to determine browser harness server address');
	}

	return {
		host,
		port: address.port,
		origin: `http://${host}:${address.port}`,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve(undefined);
				});
			})
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number.parseInt(process.env.WASM_RUST_BROWSER_HARNESS_PORT || '4174', 10);
	const server = await startBrowserHarnessServer({ port });
	console.log(JSON.stringify(server, null, 2));
	const stop = async () => {
		await server.close();
		process.exit(0);
	};
	process.on('SIGINT', () => void stop());
	process.on('SIGTERM', () => void stop());
}
