import svelteConfig from './svelte.config.js';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const tinyGoCompilePath = `${svelteConfig.kit?.paths?.base ?? ''}/api/tinygo/compile`;
const tinyGoHostCompilerModuleUrl = new URL(
	'../wasm-tinygo/scripts/tinygo-host-compiler.mjs',
	import.meta.url
).href;

function createTinyGoHostCompilePlugin() {
	const installMiddleware = (middlewares: { use: (handler: (...args: any[]) => unknown) => void }) => {
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
				res.end(JSON.stringify({ error: 'TinyGo host compile only accepts POST requests' }));
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
				res.end(JSON.stringify({ error: 'TinyGo host compile requires a non-empty source string' }));
				return;
			}

			try {
				const { compileTinyGoHostSource } = (await import(
					/* @vite-ignore */ tinyGoHostCompilerModuleUrl
				)) as {
					compileTinyGoHostSource: (options: { source: string }) => Promise<{
						artifact: { bytes: Uint8Array; entrypoint: '_start' | '_initialize' | null; path: string; size: number };
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
		configurePreviewServer(server: { middlewares: { use: (handler: (...args: any[]) => unknown) => void } }) {
			installMiddleware(server.middlewares);
		},
		configureServer(server: { middlewares: { use: (handler: (...args: any[]) => unknown) => void } }) {
			installMiddleware(server.middlewares);
		},
		name: 'tinygo-host-compile'
	};
}

export default defineConfig({
	plugins: [createTinyGoHostCompilePlugin(), sveltekit()],
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
