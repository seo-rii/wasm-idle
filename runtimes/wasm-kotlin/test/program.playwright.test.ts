import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import ts from 'typescript';
import { expect, it } from 'vitest';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function baselineFile(directory: string, relative: unknown, maximum: number) {
	if (
		typeof relative !== 'string' ||
		!relative ||
		relative.includes('\\') ||
		relative.includes('\0') ||
		relative.startsWith('/') ||
		relative.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid baseline relative path');
	let filename = directory;
	for (const component of relative.split('/')) {
		filename = path.join(filename, component);
		if ((await lstat(filename)).isSymbolicLink()) throw new Error('Baseline symlink rejected');
	}
	const info = await lstat(filename);
	if (!info.isFile() || info.size > maximum) throw new Error('Oversized baseline file');
	const bytes = await readFile(filename);
	if (bytes.byteLength > maximum) throw new Error('Baseline file grew past byte limit');
	return bytes;
}

it.skipIf(process.env.WASM_IDLE_RUN_KOTLIN_PROGRAMS !== '1')(
	'executes official JVM-hosted Kotlin Hello World and input-dependent Fibonacci in offline Chromium Workers',
	async () => {
		if (!process.env.KOTLIN_BASELINE_DIR) throw new Error('KOTLIN_BASELINE_DIR is required');
		const directory = path.resolve(process.env.KOTLIN_BASELINE_DIR);
		const receiptBytes = await baselineFile(directory, 'receipt.json', 1024 * 1024);
		const receipt = JSON.parse(receiptBytes.toString('utf8'));
		expect(receipt.kind).toBe('jvm-hosted-kotlin-wasi-baseline');
		expect(receipt.compilerHost).toBe('jvm');
		expect(receipt.programTarget).toBe('wasmWasi');
		expect(receipt.compiler.version).toBe('2.5.0-dev-10106');
		expect(receipt.compiler.role).toBe('bootstrap-reference');
		// The bootstrap binary has not been proven to represent the candidate source commit.
		expect(receipt.compiler.sourceCommit).toBeNull();
		expect(Array.isArray(receipt.cases) && receipt.cases.length <= 32).toBe(true);
		const programs = await Promise.all(
			['hello-world', 'fibonacci'].map(async (id) => {
				const matches = receipt.cases.filter((entry: { id: string }) => entry.id === id);
				expect(matches).toHaveLength(1);
				const entry = matches[0];
				const source = await baselineFile(directory, entry.sourcePath, 2 * 1024 * 1024);
				const bytes = await baselineFile(directory, entry.wasmPath, 8 * 1024 * 1024);
				expect(digest(source)).toBe(entry.sourceSha256);
				expect(digest(bytes)).toBe(entry.wasmSha256);
				expect(entry.entry).toEqual({ kind: 'command', exportName: '_start' });
				return {
					id,
					source: source.toString('utf8'),
					bytes: Array.from(bytes),
					sourceSha256: digest(source),
					wasmSha256: digest(bytes),
					wasmBytes: bytes.length
				};
			})
		);
		const files = ['wasi', 'program', 'program.worker'] as const;
		const sources = await Promise.all(
			files.map(async (name) => {
				const source = await readFile(
					new URL(`../src/${name}.ts`, import.meta.url),
					'utf8'
				);
				return {
					name,
					source,
					js: ts.transpileModule(source, {
						compilerOptions: {
							target: ts.ScriptTarget.ES2022,
							module: ts.ModuleKind.ES2022
						}
					}).outputText
				};
			})
		);
		const browser = await chromium.launch({ headless: true });
		try {
			const context = await browser.newContext();
			await context.route('https://kotlin-program-probe.invalid/**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: '<!doctype html><title>Kotlin WASI baseline</title>'
				})
			);
			const page = await context.newPage();
			await page.goto('https://kotlin-program-probe.invalid/');
			await context.setOffline(true);
			const requests: string[] = [];
			context.on('request', (request) => requests.push(request.url()));
			const results = await page.evaluate(
				async ({ sources, programs }) => {
					const urls: string[] = [];
					const moduleUrl = (source: string) => {
						const url = URL.createObjectURL(
							new Blob([source], { type: 'text/javascript' })
						);
						urls.push(url);
						return url;
					};
					const wasi = moduleUrl(sources[0]!.js);
					const program = moduleUrl(
						sources[1]!.js.replace("from './wasi.js'", `from '${wasi}'`)
					);
					const workerUrl = moduleUrl(
						sources[2]!.js.replace("from './program.js'", `from '${program}'`)
					);
					const results: Array<Record<string, unknown>> = [];
					const heading = document.createElement('h1');
					heading.textContent = 'Kotlin/Wasm — actual browser execution';
					document.body.append(heading);
					const note = document.createElement('p');
					note.textContent =
						'Compiled on the development machine with the official Kotlin compiler. Browser compilation is pending.';
					document.body.append(note);
					document.body.style.cssText =
						'font:16px system-ui;max-width:1000px;margin:32px auto;color:#172033;background:#f7f8fc';
					try {
						for (const { id, stdin, maxOutputBytes } of [
							{ id: 'hello-world', stdin: '', maxOutputBytes: 1024 },
							{ id: 'fibonacci', stdin: '10\n', maxOutputBytes: 1024 },
							{ id: 'fibonacci', stdin: '20\n', maxOutputBytes: 1024 },
							{ id: 'hello-world', stdin: '', maxOutputBytes: 0 },
							{ id: 'hello-world', stdin: '', maxOutputBytes: 1024 }
						]) {
							const artifact = programs.find((entry) => entry.id === id)!;
							const requestId = `program-${results.length}`;
							const generation = results.length;
							// The external watchdog begins before engine compilation or instantiation.
							const worker = new Worker(workerUrl, { type: 'module' });
							let heartbeats = 0;
							const heartbeat = setInterval(() => heartbeats++, 1);
							const start = performance.now();
							let response: Record<string, unknown>;
							try {
								response = await new Promise<Record<string, unknown>>(
									(resolve, reject) => {
										const timeout = setTimeout(
											() =>
												reject(
													new Error('Kotlin run Worker deadline exceeded')
												),
											10_000
										);
										worker.onmessage = ({ data }) => {
											if (data.fatal) {
												clearTimeout(timeout);
												reject(new Error(data.fatal));
												return;
											}
											if (
												data.requestId !== requestId ||
												data.generation !== generation
											)
												return;
											clearTimeout(timeout);
											resolve(data.result);
										};
										worker.onerror = (event) => {
											clearTimeout(timeout);
											reject(new Error(event.message));
										};
										const bytes = new Uint8Array(artifact.bytes).buffer;
										worker.postMessage(
											{
												requestId,
												generation,
												bytes,
												stdin: new TextEncoder().encode(stdin),
												maxOutputBytes
											},
											[bytes]
										);
									}
								);
							} finally {
								clearInterval(heartbeat);
								worker.terminate();
							}
							results.push({
								id,
								stdin,
								maxOutputBytes,
								...response,
								heartbeats,
								elapsedMs: performance.now() - start
							});
							if (results.length <= 3) {
								const panel = document.createElement('section');
								panel.style.cssText =
									'background:white;padding:16px 24px;margin:20px 0;border:1px solid #dce0ec;border-radius:8px';
								const title = document.createElement('h2');
								title.textContent = `${id}${stdin ? ` · stdin=${stdin.trim()}` : ''}`;
								const code = document.createElement('pre');
								code.textContent = artifact.source;
								const output = document.createElement('pre');
								output.textContent = `stdout:\n${String(response.stdout)}status: ${String(response.status)}`;
								output.style.cssText =
									'padding:12px;background:#eef8ef;color:#175426';
								panel.append(title, code, output);
								document.body.append(panel);
							}
						}
						return results;
					} finally {
						urls.forEach((url) => URL.revokeObjectURL(url));
					}
				},
				{ sources: sources.map(({ name, js }) => ({ name, js })), programs }
			);
			expect(
				results.map(
					({ id, stdin, status, stdout, stderr, exitCode, outputLimitExceeded }) => ({
						id,
						stdin,
						status,
						stdout,
						stderr,
						exitCode,
						outputLimitExceeded
					})
				)
			).toEqual([
				{
					id: 'hello-world',
					stdin: '',
					status: 'completed',
					stdout: 'Hello World\n',
					stderr: '',
					exitCode: 0,
					outputLimitExceeded: false
				},
				{
					id: 'fibonacci',
					stdin: '10\n',
					status: 'completed',
					stdout: '55\n',
					stderr: '',
					exitCode: 0,
					outputLimitExceeded: false
				},
				{
					id: 'fibonacci',
					stdin: '20\n',
					status: 'completed',
					stdout: '6765\n',
					stderr: '',
					exitCode: 0,
					outputLimitExceeded: false
				},
				{
					id: 'hello-world',
					stdin: '',
					status: 'output-limit',
					stdout: '',
					stderr: '',
					exitCode: null,
					outputLimitExceeded: true
				},
				{
					id: 'hello-world',
					stdin: '',
					status: 'completed',
					stdout: 'Hello World\n',
					stderr: '',
					exitCode: 0,
					outputLimitExceeded: false
				}
			]);
			expect(results.every((entry) => Number(entry.heartbeats) > 0)).toBe(true);
			expect(requests).toEqual([]);
			if (process.env.KOTLIN_BASELINE_SCREENSHOT) {
				await page.screenshot({
					path: process.env.KOTLIN_BASELINE_SCREENSHOT,
					fullPage: true
				});
			}
			if (process.env.KOTLIN_PROGRAM_EVIDENCE_FILE) {
				await writeFile(
					process.env.KOTLIN_PROGRAM_EVIDENCE_FILE,
					JSON.stringify(
						{
							schemaVersion: 1,
							kind: 'kotlin-wasi-program-browser-baseline',
							status: 'passed',
							compiler: receipt.compiler,
							compilerHost: 'jvm',
							programTarget: 'wasmWasi',
							baselineReceiptSha256: digest(receiptBytes),
							stdlib: receipt.stdlib,
							adapterSources: sources.map(({ name, source }) => ({
								name,
								sha256: digest(source)
							})),
							probeSha256: digest(await readFile(new URL(import.meta.url))),
							programs: programs.map(
								({ id, sourceSha256, wasmSha256, wasmBytes }) => ({
									id,
									sourceSha256,
									wasmSha256,
									wasmBytes
								})
							),
							browser: {
								name: 'Chromium',
								version: browser.version(),
								headless: true
							},
							environment: {
								os: `${process.platform} ${release()}`,
								arch: process.arch,
								cpu: cpus()[0]?.model ?? null,
								ramBytes: totalmem(),
								node: process.version,
								typescript: ts.version
							},
							network: { offline: true, requests },
							results,
							gates: {
								browserProgramExecution: 'passed',
								browserKotlinCompilation: 'not-run',
								candidateCompilerR0: 'not-run',
								patchedTargetStdlib: 'not-run',
								publicLanguageSupport: false
							}
						},
						null,
						2
					) + '\n',
					{ flag: 'wx', mode: 0o600 }
				);
			}
		} finally {
			await browser.close();
		}
	},
	60_000
);
