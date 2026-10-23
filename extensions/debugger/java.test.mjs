import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { launchDebuggerBrowser } from './test-support.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const enabled = process.env.WASM_IDLE_RUN_CDP_JAVA === '1';

test(
	'Java native stepping skips generated Scanner code in a padded source and preserves user helper methods',
	{ skip: !enabled, timeout: 180_000 },
	async (t) => {
		const common = {
			absWorkingDir: root,
			bundle: true,
			format: 'esm',
			platform: 'browser',
			write: false,
			alias: {
				$lib: resolve(root, 'src/lib'),
				'@wasm-idle/core': resolve(root, 'packages/core/src/index.ts'),
				'@wasm-idle/debug': resolve(root, 'packages/debug/src/adapter/index.ts')
			}
		};
		const [host, worker] = await Promise.all([
			build({
				...common,
				entryPoints: ['src/lib/playground/java.ts'],
				plugins: [
					{
						name: 'java-worker',
						setup(builder) {
							builder.onResolve({ filter: /\/worker\/java\?worker$/ }, () => ({
								path: 'java-worker',
								namespace: 'java-worker'
							}));
							builder.onLoad({ filter: /.*/, namespace: 'java-worker' }, () => ({
								contents:
									'export default class extends Worker { constructor(options) { super("/worker.js", {type:"module", ...options}); } }',
								loader: 'js'
							}));
						}
					}
				]
			}),
			build({ ...common, entryPoints: ['src/lib/playground/worker/java.ts'] })
		]);
		const assets = new Map();
		for (const file of [
			'compiler.wasm',
			'compiler.wasm-runtime.js',
			'compiler.wasm-deobfuscator.wasm',
			'compile-classlib-teavm.bin',
			'runtime-classlib-teavm.bin'
		]) {
			const path = resolve(root, 'static/teavm', file);
			assets.set(
				`/teavm/${file}`,
				await readFile(path).catch(async (error) => {
					if (error.code !== 'ENOENT') throw error;
					return gunzipSync(await readFile(`${path}.gz`));
				})
			);
		}
		const server = createServer((request, response) => {
			response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
			const path = request.url;
			response.setHeader(
				'Content-Type',
				path.endsWith('.wasm')
					? 'application/wasm'
					: path.endsWith('.js')
						? 'text/javascript'
						: path === '/'
							? 'text/html'
							: 'application/octet-stream'
			);
			const body =
				path === '/'
					? '<!doctype html><script type="module">import Java from "/java.js"; globalThis.Java = Java;</script>'
					: path === '/java.js'
						? host.outputFiles[0].contents
						: path === '/worker.js'
							? worker.outputFiles[0].contents
							: assets.get(path);
			if (!body) {
				response.writeHead(404).end();
				return;
			}
			response.end(body);
		});
		await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
		let browser;
		try {
			browser = await launchDebuggerBrowser(`http://127.0.0.1:${server.address().port}/`);
			const { page } = browser;
			page.on('pageerror', (error) => t.diagnostic(error.message));
			await page.waitForFunction(() => globalThis.Java);
			await page.evaluate(async () => {
				globalThis.sandbox = new Java();
				globalThis.events = [];
				globalThis.output = [];
				sandbox.ondebug = (event) => events.push(event);
				sandbox.output = (chunk) => output.push(chunk);
				await sandbox.load({ rootUrl: location.origin, persistentCache: false });
				// The existing stdin transform appends its generated Scanner after trimEnd().
				// Trailing source lines must not make that compatibility code look user-authored.
				const source =
					'import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    int value = new Scanner(System.in).nextInt();\n    value = Helper.add(value);\n    System.out.println(value);\n  }\n}\nfinal class Helper {\n  static int add(int value) {\n    return value + 2;\n  }\n}' +
					'\n'.repeat(300);
				globalThis.running = sandbox
					.run(source, false, false, undefined, [], {
						debugMode: 'cdp',
						stdin: '7\n',
						breakpoints: [4, 54],
						pauseOnEntry: false,
						activePath: 'Main.java'
					})
					.then(
						(result) => {
							globalThis.result = result;
						},
						(error) => {
							globalThis.error = String(error);
						}
					);
			});
			await page.waitForFunction(
				() => events.some((event) => event.type === 'pause') || globalThis.error,
				undefined,
				{ timeout: 90_000 }
			);
			assert.equal(await page.evaluate(() => globalThis.error), undefined);
			assert.deepEqual(
				await page.evaluate(() => {
					const pause = events.find((event) => event.type === 'pause');
					return {
						line: pause.line,
						path: pause.sourcePath,
						method: pause.callStack[0].functionName,
						locals: pause.locals
					};
				}),
				{ line: 4, path: 'Main.java', method: 'Main.main', locals: [] }
			);
			assert.equal(
				await page.evaluate(
					() =>
						events
							.filter((event) => event.type === 'breakpoints')
							.flatMap((event) => event.breakpoints)
							.find((breakpoint) => breakpoint.requestedLine === 54)?.verified
				),
				false
			);
			await page.evaluate(() => {
				globalThis.nativePauses = [];
				const adapter = sandbox.cdpSession.adapter;
				globalThis.locations = [...adapter.wasm.values()].flat();
				adapter.options.transport.onEvent((event) => {
					if (event.method === 'Debugger.paused' && nativePauses.length < 50)
						nativePauses.push({
							reason: event.params.reason,
							frames: event.params.callFrames.slice(0, 3).map((frame) => ({
								name: frame.functionName,
								location: frame.location
							}))
						});
				});
			});
			assert.equal(
				await page.evaluate(() =>
					locations.some((location) => location.functionName.startsWith('Scanner.'))
				),
				false
			);
			assert.equal(
				await page.evaluate(() =>
					locations.some((location) => location.functionName === 'Helper.add')
				),
				true
			);
			await page.evaluate(() => sandbox.debugCommand('stepInto'));
			try {
				await page.waitForFunction(
					() =>
						events.filter((event) => event.type === 'pause').length >= 2 ||
						globalThis.error
				);
			} catch (error) {
				t.diagnostic(
					JSON.stringify(
						await page.evaluate(() => ({
							events,
							output,
							nativePauses,
							locations,
							error: globalThis.error
						}))
					)
				);
				throw error;
			}
			assert.deepEqual(
				await page.evaluate(() => {
					const pause = events.filter((event) => event.type === 'pause').at(-1);
					return { line: pause.line, method: pause.callStack[0].functionName };
				}),
				{ line: 11, method: 'Helper.add' }
			);
			await page.evaluate(() => sandbox.debugCommand('stepOut'));
			await page.waitForFunction(
				() =>
					events.filter((event) => event.type === 'pause').length >= 3 || globalThis.error
			);
			assert.equal(
				await page.evaluate(
					() => events.filter((event) => event.type === 'pause').at(-1).line
				),
				6
			);
			await page.evaluate(() => sandbox.debugCommand('continue'));
			await page.evaluate(() => running);
			assert.equal(await page.evaluate(() => globalThis.error), undefined);
			assert.equal(await page.evaluate(() => output.join('')), '9\n');
			await page.evaluate(() => sandbox.dispose());
		} finally {
			await browser?.dispose();
			await new Promise((done) => server.close(done));
		}
	}
);
