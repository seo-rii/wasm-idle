import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { compileOnHost } from '../dist/src/node.js';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');
const browserNativeManifestPath = path.join(
	projectRoot,
	'.cache',
	'browser-native-bundle',
	'browser-native-manifest.v1.json'
);

const contentTypes = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.wasm', 'application/wasm'],
	['.txt', 'text/plain; charset=utf-8'],
	['.map', 'application/json; charset=utf-8'],
	['.ml', 'text/plain; charset=utf-8']
]);

function detectOpamBin() {
	const localPath = path.join(projectRoot, '.cache', 'opam-2.2.1');
	return localPath;
}

async function ensureBrowserNativeBundle() {
	try {
		await stat(browserNativeManifestPath);
		return;
	} catch {
		await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'prepare-browser-native.mjs')], {
				cwd: projectRoot,
				env: process.env,
				stdio: 'inherit'
			});
			child.on('error', reject);
			child.on('close', (code) => {
				if (code === 0) {
					resolve(undefined);
					return;
				}
				reject(new Error(`prepare-browser-native.mjs failed with exit code ${code ?? 1}`));
			});
		});
	}
}

async function resolveSwitchPrefix(opamBin, opamRoot, switchName) {
	return await new Promise((resolve, reject) => {
		const processRef = spawn(opamBin, ['var', 'prefix', '--root', opamRoot, '--switch', switchName], {
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const stdoutParts = [];
		const stderrParts = [];
		processRef.stdout.on('data', (chunk) => {
			stdoutParts.push(Buffer.from(chunk));
		});
		processRef.stderr.on('data', (chunk) => {
			stderrParts.push(Buffer.from(chunk));
		});
		processRef.on('error', reject);
		processRef.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(Buffer.concat(stderrParts).toString('utf8') || `opam var prefix failed with ${code}`)
				);
				return;
			}
			resolve(Buffer.concat(stdoutParts).toString('utf8').trim());
		});
	});
}

async function handleCompileRequest(request, response) {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(Buffer.from(chunk));
	}
	const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	const fixturePath = path.join(projectRoot, 'fixtures', 'hello', payload.entry || 'hello.ml');
	const source = await readFile(fixturePath, 'utf8');
	const opamRoot =
		process.env.WASM_OF_JS_OF_OCAML_OPAM_ROOT ||
		path.join(process.env.HOME || process.cwd(), '.cache', 'wasm-of-js-of-ocaml', 'opam');
	const switchName = process.env.WASM_OF_JS_OF_OCAML_SWITCH_NAME || 'wasm-of-js-of-ocaml';
	const opamBin = process.env.WASM_OF_JS_OF_OCAML_OPAM_BIN || detectOpamBin();
	const switchPrefix =
		process.env.WASM_OF_JS_OF_OCAML_SWITCH_PREFIX ||
		(await resolveSwitchPrefix(opamBin, opamRoot, switchName));
	const binaryenBin = process.env.WASM_OF_JS_OF_OCAML_BINARYEN_BIN || detectBinaryenBin();

	const result = await compileOnHost(
		{
			files: {
				[payload.entry || 'hello.ml']: source
			},
			entry: payload.entry || 'hello.ml',
			target: payload.target === 'js' ? 'js' : 'wasm'
		},
		{
			switchPrefix,
			binaryenBin
		}
	);

	const responseBody = JSON.stringify(
		{
			success: result.success,
			stdout: result.stdout,
			stderr: result.stderr,
			diagnostics: result.diagnostics,
			artifacts: result.artifacts.map((artifact) => ({
				path: artifact.path,
				kind: artifact.kind,
				size:
					typeof artifact.data === 'string'
						? Buffer.byteLength(artifact.data, 'utf8')
						: artifact.data.byteLength
			}))
		},
		null,
		2
	);
	response.writeHead(result.success ? 200 : 500, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(responseBody)
	});
	response.end(responseBody);
}

function resolveStaticPath(requestPath) {
	const pathname = new URL(requestPath, 'http://127.0.0.1').pathname;
	const relativePath =
		pathname === '/' ? 'browser-harness/index.html' : pathname.replace(/^\/+/, '');
	const absolutePath = path.resolve(projectRoot, relativePath);
	if (!absolutePath.startsWith(projectRoot + path.sep) && absolutePath !== projectRoot) {
		return null;
	}
	return absolutePath;
}

const server = http.createServer(async (request, response) => {
	try {
		if (!request.url) {
			response.writeHead(400);
			response.end('missing url');
			return;
		}
		if (request.method === 'POST' && request.url.startsWith('/api/compile')) {
			await handleCompileRequest(request, response);
			return;
		}
		const absolutePath = resolveStaticPath(request.url);
		if (!absolutePath) {
			response.writeHead(403);
			response.end('forbidden');
			return;
		}
		const filePath = absolutePath.endsWith(path.sep)
			? path.join(absolutePath, 'index.html')
			: absolutePath;
		const body = await readFile(filePath);
		response.writeHead(200, {
			'content-type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
			'content-length': body.byteLength,
			'cache-control': 'no-store'
		});
		response.end(body);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		response.writeHead(500, {
			'content-type': 'text/plain; charset=utf-8',
			'content-length': Buffer.byteLength(message)
		});
		response.end(message);
	}
});

const port = Number.parseInt(process.env.WASM_OF_JS_OF_OCAML_BROWSER_HARNESS_PORT || '4174', 10);
await ensureBrowserNativeBundle();
server.listen(port, '127.0.0.1', () => {
	process.stdout.write(`http://127.0.0.1:${port}\n`);
});

const shutdown = () => {
	server.close(() => {
		process.exit(0);
	});
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
