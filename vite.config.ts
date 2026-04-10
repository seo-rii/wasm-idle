import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.js';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(THIS_FILE);
const appBasePath = (svelteConfig.kit?.paths?.base ?? '').replace(/\/+$/, '');
const tinyGoCompilePath = `${appBasePath}/api/tinygo/compile`;
const tinyGoHostCompilerModuleUrl = new URL(
	'../wasm-tinygo/scripts/tinygo-host-compiler.mjs',
	import.meta.url
).href;
const ocamlBinaryenCommandPath = `${appBasePath}/api/binaryen-command`;
const localOcamlBinaryenBin = path.join(REPO_ROOT, '.cache', 'wasm-of-js-of-ocaml-binaryen', 'bin');
const siblingOcamlBinaryenBin = path.resolve(
	REPO_ROOT,
	'..',
	'wasm-of-js-of-ocaml',
	'.cache',
	'binaryen-version_129',
	'bin'
);

function rewriteBinaryenVirtualPaths(command: string, stagingRoot: string) {
	return command
		.replaceAll('/tmp/', `${path.join(stagingRoot, 'tmp').replace(/\\/g, '/')}/`)
		.replaceAll('/workspace/', `${path.join(stagingRoot, 'workspace').replace(/\\/g, '/')}/`)
		.replaceAll('/static/', `${path.join(stagingRoot, 'static').replace(/\\/g, '/')}/`);
}

async function readJsonRequest(req: AsyncIterable<unknown>) {
	let requestBody = '';
	for await (const chunk of req) {
		requestBody += String(chunk);
	}
	return requestBody.trim() ? JSON.parse(requestBody) : {};
}

function detectOcamlBinaryenBin() {
	return localOcamlBinaryenBin;
}

function createTinyGoHostCompilePlugin() {
	const installMiddleware = (middlewares: {
		use: (handler: (...args: any[]) => unknown) => void;
	}) => {
		middlewares.use(async (req: any, res: any, next: () => void) => {
			if (!req.url) {
				next();
				return;
			}

			const requestUrl = new URL(req.url, 'http://localhost');
			if (requestUrl.pathname !== tinyGoCompilePath) {
				next();
				return;
			}
			if (req.method !== 'POST') {
				res.statusCode = 405;
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({ error: 'TinyGo host compile only accepts POST requests' })
				);
				return;
			}

			let requestBody = '';
			for await (const chunk of req) {
				requestBody += String(chunk);
			}

			let payload: { source?: string } = {};
			try {
				payload = requestBody.trim() ? JSON.parse(requestBody) : {};
			} catch {
				res.statusCode = 400;
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ error: 'TinyGo host compile received invalid JSON' }));
				return;
			}
			if (typeof payload.source !== 'string' || payload.source.trim() === '') {
				res.statusCode = 400;
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						error: 'TinyGo host compile requires a non-empty source string'
					})
				);
				return;
			}

			try {
				const { compileTinyGoHostSource } = (await import(
					/* @vite-ignore */ tinyGoHostCompilerModuleUrl
				)) as {
					compileTinyGoHostSource: (options: { source: string }) => Promise<{
						artifact: {
							bytes: Uint8Array;
							entrypoint: '_start' | '_initialize' | null;
							path: string;
							size: number;
						};
						target: string;
						targetInfo: { scheduler: string };
						toolchain: { version: string };
					}>;
				};
				const result = await compileTinyGoHostSource({
					source: payload.source
				});
				res.statusCode = 200;
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						artifact: {
							bytesBase64: Buffer.from(result.artifact.bytes).toString('base64'),
							entrypoint: result.artifact.entrypoint,
							path: result.artifact.path,
							runnable: result.artifact.entrypoint !== null
						},
						logs: [
							`tinygo host compile ready: target=${result.target} scheduler=${result.targetInfo.scheduler || 'unknown'} version=${result.toolchain.version}`,
							`tinygo host artifact built: ${result.artifact.path} (${result.artifact.size} bytes)`
						]
					})
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				res.statusCode =
					message.includes('TinyGo release fetch failed') || message.includes('toolchain')
						? 503
						: 422;
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ error: message }));
			}
		});
	};

	return {
		configurePreviewServer(server: {
			middlewares: { use: (handler: (...args: any[]) => unknown) => void };
		}) {
			installMiddleware(server.middlewares);
		},
		configureServer(server: {
			middlewares: { use: (handler: (...args: any[]) => unknown) => void };
		}) {
			installMiddleware(server.middlewares);
		},
		name: 'tinygo-host-compile'
	};
}

function createOcamlBinaryenPlugin() {
	const installMiddleware = (middlewares: {
		use: (handler: (...args: any[]) => unknown) => void;
	}) => {
		middlewares.use(async (req: any, res: any, next: () => void) => {
			if (!req.url) {
				next();
				return;
			}

			const requestUrl = new URL(req.url, 'http://localhost');
			if (requestUrl.pathname !== ocamlBinaryenCommandPath) {
				next();
				return;
			}
			if (req.method !== 'POST') {
				res.statusCode = 405;
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({ error: 'Binaryen command bridge only accepts POST requests' })
				);
				return;
			}

			let payload:
				| {
						command?: string;
						files?: Array<{ path?: string; dataBase64?: string }>;
						outputPaths?: string[];
				  }
				| undefined;
			try {
				payload = await readJsonRequest(req);
			} catch {
				res.statusCode = 400;
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ error: 'Binaryen command bridge received invalid JSON' }));
				return;
			}

			const binaryenBin = detectOcamlBinaryenBin();
			const stagingRoot = await mkdtemp(path.join(tmpdir(), 'wasm-idle-ocaml-binaryen-'));
			try {
				for (const file of payload?.files || []) {
					const targetPath = path.join(
						stagingRoot,
						String(file.path || '').replace(/^\/+/, '')
					);
					await mkdir(path.dirname(targetPath), { recursive: true });
					await writeFile(
						targetPath,
						Buffer.from(String(file.dataBase64 || ''), 'base64')
					);
				}
				for (const outputPath of payload?.outputPaths || []) {
					const targetPath = path.join(
						stagingRoot,
						String(outputPath).replace(/^\/+/, '')
					);
					await mkdir(path.dirname(targetPath), { recursive: true });
				}

				const command = rewriteBinaryenVirtualPaths(
					String(payload?.command || ''),
					stagingRoot
				);
				const result = await new Promise<{
					exitCode: number;
					stdout: string;
					stderr: string;
				}>((resolve, reject) => {
					const stdoutParts: Buffer[] = [];
					const stderrParts: Buffer[] = [];
					const child = spawn('/bin/bash', ['-c', command], {
						cwd: stagingRoot,
						env: {
							...process.env,
							PATH: `${binaryenBin}:${process.env.PATH || ''}`
						},
						stdio: ['ignore', 'pipe', 'pipe']
					});
					child.stdout.on('data', (chunk) => {
						stdoutParts.push(Buffer.from(chunk));
					});
					child.stderr.on('data', (chunk) => {
						stderrParts.push(Buffer.from(chunk));
					});
					child.on('error', reject);
					child.on('close', (code) => {
						resolve({
							exitCode: code ?? 1,
							stdout: Buffer.concat(stdoutParts).toString('utf8'),
							stderr: Buffer.concat(stderrParts).toString('utf8')
						});
					});
				});

				const outputs = [];
				for (const outputPath of payload?.outputPaths || []) {
					const translatedPath = path.join(
						stagingRoot,
						String(outputPath).replace(/^\/+/, '')
					);
					try {
						const data = await readFile(translatedPath);
						outputs.push({
							path: String(outputPath),
							dataBase64: data.toString('base64')
						});
					} catch {
						// Ignore missing optional outputs.
					}
				}

				res.statusCode = 200;
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						exitCode: result.exitCode,
						stdout: result.stdout,
						stderr: result.stderr,
						outputs
					})
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				res.statusCode = 500;
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ error: message }));
			} finally {
				await rm(stagingRoot, { recursive: true, force: true });
			}
		});
	};

	return {
		configurePreviewServer(server: {
			middlewares: { use: (handler: (...args: any[]) => unknown) => void };
		}) {
			installMiddleware(server.middlewares);
		},
		configureServer(server: {
			middlewares: { use: (handler: (...args: any[]) => unknown) => void };
		}) {
			installMiddleware(server.middlewares);
		},
		name: 'ocaml-binaryen-bridge'
	};
}

export default defineConfig({
	plugins: [createTinyGoHostCompilePlugin(), createOcamlBinaryenPlugin(), sveltekit()],
	resolve: {
		alias: {
			vscode: '@hancomac/monaco-languageclient/vscode-compatibility'
		}
	},
	worker: { format: 'es' },
	server: {
		allowedHosts: true
	}
});
