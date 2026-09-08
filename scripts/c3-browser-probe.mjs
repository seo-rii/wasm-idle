import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function runC3BrowserProbe() {
	const server = await createServer({
		configFile: false,
		root,
		publicDir: 'static',
		cacheDir: path.join(root, '.cache/c3-browser-vite'),
		resolve: {
			alias: {
				$lib: path.join(root, 'src/lib'),
				'@wasm-idle/core': path.join(root, 'packages/core/src/index.ts')
			}
		},
		plugins: [
			{
				name: 'c3-probe-public-env',
				resolveId(id) {
					if (id === '$env/dynamic/public') return '\0c3-public-env';
				},
				load(id) {
					if (id === '\0c3-public-env') return 'export const env = {};';
				},
				configureServer(vite) {
					vite.middlewares.use((request, response, next) => {
						if (request.url === '/') {
							response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
							response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
							response.setHeader('Content-Type', 'text/html');
							response.end('<!doctype html><title>C3 consumer acceptance</title>');
						} else next();
					});
				}
			}
		],
		server: {
			host: '127.0.0.1',
			port: 0,
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		}
	});
	let browser;
	try {
		await server.listen();
		const address = server.httpServer.address();
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable()
		});
		const page = await browser.newPage();
		const browserErrors = [];
		page.on('pageerror', (error) => browserErrors.push(error.message));
		await page.goto(`http://127.0.0.1:${address.port}/`);
		await page.addScriptTag({
			type: 'module',
			content:
				'import playground from "/src/lib/playground/index.ts"; globalThis.__c3Playground = playground;'
		});
		await page.waitForFunction(() => Boolean(globalThis.__c3Playground));
		const report = await page.evaluate(async () => {
			const playground = globalThis.__c3Playground;
			const source = `module main;
extern fn int read_byte() @wasm("env", "readByte");
extern fn void write_byte(int value) @wasm("env", "writeByte");
fn void main() @wasm("main") {
  while (true) { int value = read_byte(); if (value < 0) break; write_byte(value); }
}`;
			const sandbox = await playground('C3');
			const results = [];
			let cancelWhenWaiting;
			let output = '';
			const diagnostics = [];
			sandbox.output = (text) => {
				output += text;
			};
			sandbox.oncompilerdiagnostic = (value) => diagnostics.push(value);
			await sandbox.load({ c3: { baseUrl: location.origin + '/wasm-c3/' } });
			async function run(name, code, options = {}, interact) {
				output = '';
				diagnostics.length = 0;
				const started = performance.now();
				try {
					const progress = {
						report(event) {
							if (name === 'cancel' && event.reason === 'started') {
								sandbox.worker.addEventListener('message', ({ data }) => {
									if (data?.type === 'stdin-request') cancelWhenWaiting?.();
								});
							}
						}
					};
					const pending = sandbox.run(code, false, false, progress, [], options);
					pending.catch(() => {});
					if (interact) await interact();
					const result = await pending;
					results.push({
						name,
						result,
						output,
						diagnostics: [...diagnostics],
						memory: sandbox.memoryEvidence.current,
						elapsedMs: performance.now() - started
					});
				} catch (error) {
					results.push({
						name,
						output,
						diagnostics: [...diagnostics],
						memory: sandbox.memoryEvidence.current,
						error: {
							message: error.message,
							code: error.code,
							phase: error.phase,
							actual: error.actual,
							limit: error.limit,
							resource: error.resource
						}
					});
				}
			}
			try {
				await run('utf8', source, { stdin: '첫째 줄 🦀\nsecond line\n' });
				if (results[0].error) throw new Error(JSON.stringify(results[0]));
				// Always use a second actual compilation; a stale worker cannot satisfy this result.
				await run(
					'fresh-worker',
					source.replace('write_byte(value)', 'write_byte(value + 1)'),
					{ stdin: 'ABC' }
				);
				await run(
					'workspace-module',
					source
						.replace('module main;', 'module main; import helper;')
						.replace('write_byte(value)', 'write_byte(helper::increment(value))'),
					{
						stdin: 'ABC',
						activePath: 'src/main.c3',
						workspaceFiles: [
							{
								path: 'src/helper.c3',
								content:
									'module helper; fn int increment(int value) { return value + 2; }'
							}
						]
					}
				);
				await run(
					'diagnostic',
					'module main;\nfn void main() @wasm("main") { missing_value(); }',
					{ stdin: '' }
				);
				await run('memory-minimum', source, {
					stdin: '',
					limits: { maxWasmMemoryBytes: 64 * 1024 ** 2 }
				});
				await run('compiler-oom', source, {
					stdin: '',
					limits: { maxWasmMemoryBytes: 160 * 1024 ** 2 }
				});
				await run('output-limit', source, {
					stdin: 'A'.repeat(1025),
					limits: { maxOutputBytes: 1024 }
				});
				await run(
					'run-timeout',
					source.replace(
						'while (true) { int value = read_byte(); if (value < 0) break; write_byte(value); }',
						'while (read_byte() < 0) {}'
					),
					{ stdin: '', limits: { runTimeoutMs: 100 } }
				);
				await run('compile-timeout', source, {
					stdin: '',
					limits: { compileTimeoutMs: 1 }
				});
				let ready;
				const waiting = new Promise((resolve) => {
					ready = resolve;
				});
				const previousOutput = sandbox.output;
				sandbox.output = (text) => {
					previousOutput(text);
					if (output.includes('?\n')) ready();
				};
				await run(
					'streaming',
					source.replace('while (true)', 'write_byte(63); write_byte(10); while (true)'),
					{},
					async () => {
						await Promise.race([
							waiting,
							new Promise((_, reject) =>
								setTimeout(
									() => reject(new Error('Streaming prompt timeout')),
									30000
								)
							)
						]);
						sandbox.write('stream 한글 🦀\n');
						sandbox.eof();
					}
				);
				const controller = new AbortController();
				cancelWhenWaiting = () => controller.abort('C3 stdin wait cancellation');
				await run('cancel', source, { signal: controller.signal });
				await run('after-cancel', source, { stdin: 'recovered\n' });
				await run(
					'guest-memory-grow',
					`module main;
extern fn void write_byte(int value) @wasm("env", "writeByte");
fn void main() @wasm("main") {
  sz remaining = 1024 - $$wasm_memory_size(0);
  if ($$wasm_memory_grow(0, remaining) >= 0 && $$wasm_memory_grow(0, 1) == -1) write_byte(89);
}`,
					{ stdin: '' }
				);
			} finally {
				await sandbox.dispose();
			}
			return { crossOriginIsolated, stdinMode: sandbox.stdinMode, results };
		});
		console.log(
			JSON.stringify({ engine: await browser.version(), ...report, browserErrors }, null, 2)
		);
		assert.equal(report.crossOriginIsolated, true);
		assert.equal(report.stdinMode, 'streaming');
		const byName = Object.fromEntries(report.results.map((result) => [result.name, result]));
		assert.equal(byName.utf8.result, true, JSON.stringify(byName.utf8));
		assert.equal(byName.utf8.output, '첫째 줄 🦀\nsecond line\n');
		assert.equal(byName['fresh-worker'].output, 'BCD');
		assert.equal(byName['workspace-module'].output, 'CDE');
		assert.equal(byName.diagnostic.error?.code, 'compile');
		assert.equal(byName.diagnostic.diagnostics[0]?.lineNumber, 2);
		assert.equal(byName['memory-minimum'].error?.code, 'resource-limit');
		assert.equal(byName['compiler-oom'].error?.code, 'resource-limit');
		assert.equal(byName['output-limit'].error?.code, 'output-limit');
		assert.equal(byName['output-limit'].error?.phase, 'execute');
		assert.equal(byName['run-timeout'].error?.code, 'timeout');
		assert.equal(byName['run-timeout'].error?.phase, 'execute');
		assert.equal(byName['compile-timeout'].error?.phase, 'compile');
		assert.equal(byName.streaming.output, '?\nstream 한글 🦀\n');
		assert.equal(byName.cancel.error?.code, 'cancelled');
		assert.equal(byName['after-cancel'].output, 'recovered\n');
		assert.equal(byName['guest-memory-grow'].output, 'Y');
		const memory = byName.utf8.memory;
		assert.equal(
			memory.compiler.originalSha256,
			createHash('sha256')
				.update(await readFile(path.join(root, 'static/wasm-c3/c3c.wasm')))
				.digest('hex')
		);
		assert.notEqual(memory.compiler.originalSha256, memory.compiler.limitedSha256);
		assert.equal(memory.limitBytes, 1024 ** 3);
		assert.ok(memory.compiler.maximumBytes + memory.guest.maximumBytes <= memory.limitBytes);
		assert.deepEqual(browserErrors, []);
		const bufferedPage = await browser.newPage();
		await bufferedPage.route('**/buffered', (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><title>C3 buffered acceptance</title>'
			})
		);
		await bufferedPage.goto(`http://127.0.0.1:${address.port}/buffered`);
		await bufferedPage.addScriptTag({
			type: 'module',
			content:
				'import playground from "/src/lib/playground/index.ts"; globalThis.__c3Playground = playground;'
		});
		await bufferedPage.waitForFunction(() => Boolean(globalThis.__c3Playground));
		const buffered = await bufferedPage.evaluate(async () => {
			const sandbox = await globalThis.__c3Playground('C3', {
				c3: { baseUrl: location.origin + '/wasm-c3/' }
			});
			let output = '';
			sandbox.output = (text) => {
				output += text;
			};
			try {
				await sandbox.load();
				const result = await sandbox.run(
					`module main;
extern fn int next_byte() @wasm("env", "readByte");
extern fn void write_byte(int value) @wasm("env", "writeByte");
fn void main() @wasm("main") { while (true) { int byte = next_byte(); if (byte < 0) break; write_byte(byte); } }`,
					false,
					false,
					undefined,
					[],
					{ stdin: 'buffered 한글 🦀\n' }
				);
				return {
					isolated: crossOriginIsolated,
					mode: sandbox.stdinMode,
					result,
					output,
					memory: sandbox.memoryEvidence.current
				};
			} finally {
				await sandbox.dispose();
			}
		});
		assert.equal(buffered.isolated, false);
		assert.equal(buffered.mode, 'prebuffered');
		assert.equal(buffered.result, true);
		assert.equal(buffered.output, 'buffered 한글 🦀\n');
		assert.equal(buffered.memory.limitBytes, 1024 ** 3);
		await bufferedPage.route('**/wasm-c3/c3c.mjs', async (route) => {
			const response = await route.fetch();
			const body = Buffer.from(await response.body());
			body[0] ^= 1;
			await route.fulfill({ response, body });
		});
		const integrityError = await bufferedPage.evaluate(async () => {
			const sandbox = await globalThis.__c3Playground('C3', {
				c3: { baseUrl: location.origin + '/wasm-c3/' }
			});
			try {
				await sandbox.load();
				return null;
			} catch (error) {
				return { code: error.code, phase: error.phase };
			} finally {
				await sandbox.dispose();
			}
		});
		assert.deepEqual(integrityError, { code: 'asset-integrity', phase: 'asset' });
		console.log(JSON.stringify({ buffered, integrityError }, null, 2));
		return { ...report, buffered, integrityError };
	} finally {
		await browser?.close();
		await server.close();
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await runC3BrowserProbe();
