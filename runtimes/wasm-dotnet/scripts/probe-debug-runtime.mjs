import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { inspectMonoDebuggerExports } from './inspect-debugger-exports.mjs';

// This only boots the existing browser runtime and sends Mono VM.Version.
// It does not rebuild the AOT compiler or claim breakpoint/locals support.
const root = path.resolve(process.argv[2] || new URL('../dist/', import.meta.url).pathname);
const output = path.resolve(process.argv[3] || 'out/dotnet-debug-agent.json');
const languages = (process.argv[4] || 'csharp').split(',');
if (languages.some((language) => !['csharp', 'vbnet', 'fsharp'].includes(language))) {
	throw new Error('Expected csharp, vbnet or fsharp');
}

async function probe(language) {
	globalThis.dotnetSidecar = true;
	globalThis.document ??= {
		addEventListener() {},
		removeEventListener() {},
		dispatchEvent() {
			return true;
		},
		querySelectorAll() {
			return [];
		}
	};
	let stage = 'import';
	try {
		const { dotnet } = await import(`/runtime/${language}/dotnet.js`);
		const { connectMonoDebugAgent } = await import('/index.js');
		stage = 'create';
		postMessage({ stage });
		const runtime = await dotnet
			.withModuleConfig({
				onConfigLoaded: (config) => {
					config.debugLevel = 1;
				}
			})
			.withConfig({
				jsThreadBlockingMode: 'DangerousAllowBlockingWait'
			})
			.withDebugging(1)
			.create();
		stage = 'agent-version';
		postMessage({ stage });
		const hooks = Object.keys(runtime.INTERNAL ?? {}).filter((name) =>
			/debugger|dbg_command|runtime_is_ready/u.test(name)
		);
		try {
			const agent = connectMonoDebugAgent(runtime);
			return {
				status: 'agent-connected',
				language,
				debugLevel: runtime.getConfig().debugLevel,
				hooks,
				versionReply: agent.versionReply,
				breakpointsFramesLocalsVerified: false
			};
		} catch (error) {
			return {
				status: 'blocked',
				language,
				stage,
				debugLevel: runtime.getConfig().debugLevel,
				hooks,
				error: String(error),
				breakpointsFramesLocalsVerified: false
			};
		}
	} catch (error) {
		return {
			status: 'probe-error',
			language,
			stage,
			error: String(error),
			breakpointsFramesLocalsVerified: false
		};
	}
}

const workerSource = `self.onmessage=async({data})=>postMessage({result:await (${probe.toString()})(data)});`;
const failedAssets = [];
const server = createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		if (pathname === '/') {
			response.setHeader('Content-Type', 'text/html');
			response.end(
				'<!doctype html><title>Mono debugger agent probe</title><link rel="icon" href="data:,">'
			);
			return;
		}
		if (pathname === '/debug-probe.worker.mjs') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(workerSource);
			return;
		}
		const file = path.resolve(root, `.${pathname}`);
		if (!file.startsWith(`${root}${path.sep}`)) {
			response.writeHead(403).end();
			return;
		}
		const bytes = await readFile(file);
		response.setHeader(
			'Content-Type',
			file.endsWith('.wasm')
				? 'application/wasm'
				: /\.m?js$/u.test(file)
					? 'text/javascript'
					: file.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
		);
		response.end(bytes);
	} catch (error) {
		if (failedAssets.length < 20)
			failedAssets.push({ path: request.url, error: String(error) });
		response.writeHead(404).end();
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [];
try {
	browser = await chromium.launch({ headless: true });
	for (const language of languages) {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			const consoleErrors = [];
			const requestErrors = [];
			failedAssets.length = 0;
			page.on('console', (message) => {
				if (message.type() === 'error' && consoleErrors.length < 20)
					consoleErrors.push(message.text().slice(0, 1000));
			});
			page.on('pageerror', (error) => {
				if (consoleErrors.length < 20) consoleErrors.push(String(error).slice(0, 1000));
			});
			page.on('requestfailed', (request) => {
				if (requestErrors.length < 20)
					requestErrors.push({
						path: new URL(request.url()).pathname,
						error: request.failure()?.errorText
					});
			});
			await page.goto(`http://127.0.0.1:${server.address().port}/`);
			const result = await page.evaluate(
				(language) =>
					new Promise((resolve) => {
						const worker = new Worker('/debug-probe.worker.mjs', { type: 'module' });
						let stage = 'start';
						const finish = (result) => {
							clearTimeout(timer);
							worker.terminate();
							resolve(result);
						};
						const timer = setTimeout(
							() =>
								finish({
									status: 'probe-error',
									language,
									stage,
									error: 'Timed out after 90000 ms',
									breakpointsFramesLocalsVerified: false
								}),
							90000
						);
						worker.onmessage = ({ data }) => {
							if (data.stage) stage = data.stage;
							else finish(data.result);
						};
						worker.onerror = (event) =>
							finish({
								status: 'probe-error',
								language,
								stage,
								error: event.message
							});
						worker.postMessage(language);
					}),
				language
			);
			const native = await readFile(
				path.join(root, 'runtime', language, 'dotnet.native.wasm')
			);
			results.push({
				...result,
				nativeDebuggerExports: inspectMonoDebuggerExports(native),
				consoleErrors,
				requestErrors,
				failedAssets: [...failedAssets],
				nativeSha256: createHash('sha256').update(native).digest('hex')
			});
		} finally {
			await context.close();
		}
	}
	await mkdir(path.dirname(output), { recursive: true });
	await writeFile(
		output,
		`${JSON.stringify({ schemaVersion: 1, probedAt: new Date().toISOString(), results }, null, 2)}\n`
	);
	console.log(`Mono agent probe: ${output}`);
	if (results.some((result) => result.status === 'probe-error')) process.exitCode = 1;
} finally {
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
}
