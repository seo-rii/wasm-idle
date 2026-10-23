import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

it(
	'runs original PostgreSQL LSP diagnostics, schema completion and hover in Chromium',
	{
		skip: process.env.WASM_IDLE_RUN_POSTGRESQL_LSP_BROWSER !== '1',
		timeout: 120_000
	},
	async () => {
		const upstreamRoot = path.join(root, 'static/wasm-postgresql-lsp');
		// Fail when assets were not prepared; a required browser run must never silently skip.
		await readFile(path.join(upstreamRoot, 'dist/pgls.wasm'));
		const bundle = async (entry: string) =>
			(
				await build({
					entryPoints: [path.join(root, entry)],
					bundle: true,
					format: 'esm',
					platform: 'browser',
					tsconfig: path.join(root, 'packages/lsp/tsconfig.json'),
					alias: { '@wasm-idle/core': path.join(root, 'packages/core/src/index.ts') },
					write: false,
					target: 'es2022'
				})
			).outputFiles[0].text;
		const [client, worker] = await Promise.all([
			bundle('packages/lsp/src/postgresql/language-server.ts'),
			bundle('packages/lsp/src/postgresql/worker.ts')
		]);
		const requests: string[] = [];
		const server = createServer(async (request, response) => {
			try {
				const pathname = new URL(request.url || '/', 'http://localhost').pathname;
				requests.push(pathname);
				response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
				response.setHeader(
					'Content-Security-Policy',
					"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'"
				);
				if (pathname === '/') {
					response.setHeader('Content-Type', 'text/html');
					response.end(
						'<!doctype html><title>PostgreSQL LSP browser integration</title>'
					);
				} else if (pathname === '/client-entry.js') {
					response.setHeader('Content-Type', 'application/javascript');
					response.end(
						'import * as sdk from "/postgresql/language-server.js"; globalThis.postgresqlLspSdk = sdk;'
					);
				} else if (
					pathname === '/postgresql/language-server.js' ||
					pathname === '/postgresql/worker.js'
				) {
					response.setHeader('Content-Type', 'application/javascript');
					response.end(pathname.endsWith('/worker.js') ? worker : client);
				} else if (pathname.startsWith('/upstream/')) {
					const relative = pathname.slice('/upstream/'.length);
					if (relative.includes('..')) throw new Error('Invalid path');
					response.setHeader(
						'Content-Type',
						relative.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'
					);
					response.end(await readFile(path.join(upstreamRoot, relative)));
				} else {
					response.writeHead(404).end();
				}
			} catch {
				response.writeHead(500).end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing browser test server address');
		const origin = `http://127.0.0.1:${address.port}`;
		let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
		try {
			browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const context = await browser.newContext();
			await addBrowserTestCookies(context, origin);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(origin);
			await page.addScriptTag({ type: 'module', url: `${origin}/client-entry.js` });
			expect(requests.filter((url) => url.startsWith('/upstream/'))).toEqual([]);
			const result = await page.evaluate(async () => {
				const { getPostgresqlLanguageServer } = (globalThis as any).postgresqlLspSdk;
				const statuses: Array<{ state: string }> = [];
				const handle = await getPostgresqlLanguageServer({
					postgresql: { moduleUrl: `${location.origin}/upstream/dist/lsp.js` },
					onStatus: (status: { state: string }) => statuses.push(status)
				});
				const messages: Array<any> = [];
				handle.transport.reader.listen((message: unknown) => messages.push(message));
				const waitFor = async (predicate: () => any) => {
					const deadline = Date.now() + 15_000;
					while (Date.now() < deadline) {
						const value = predicate();
						if (value) return value;
						await new Promise((resolve) => setTimeout(resolve, 5));
					}
					throw new Error(
						`PostgreSQL LSP response timed out: ${JSON.stringify(messages)}`
					);
				};
				const send = (message: Record<string, unknown>) =>
					handle.transport.writer.write({ jsonrpc: '2.0', ...message });
				const request = async (id: number, method: string, params: unknown) => {
					await send({ id, method, params });
					return await waitFor(() => messages.find((message) => message.id === id));
				};
				const initialize = await request(1, 'initialize', {
					capabilities: {},
					rootUri: 'file:///workspace'
				});
				await send({ method: 'initialized', params: {} });
				const uri = 'file:///workspace/main.sql';
				await send({
					method: 'textDocument/didOpen',
					params: {
						textDocument: {
							uri,
							languageId: 'postgresql',
							version: 1,
							text: 'select from;'
						}
					}
				});
				const invalid = await waitFor(() =>
					messages.find(
						(message) =>
							message.method === 'textDocument/publishDiagnostics' &&
							message.params.diagnostics.length
					)
				);
				const beforeChange = messages.length;
				await send({
					method: 'textDocument/didChange',
					params: {
						textDocument: { uri, version: 2 },
						contentChanges: [{ text: 'select 1;' }]
					}
				});
				const cleared = await waitFor(() =>
					messages
						.slice(beforeChange)
						.find(
							(message) =>
								message.method === 'textDocument/publishDiagnostics' &&
								message.params.uri === uri &&
								!message.params.diagnostics.length
						)
				);
				await handle.setSchema(
					JSON.stringify({
						tables: [
							{
								id: 123,
								name: 'lsp_users',
								schema: 'public',
								comment: 'Browser schema example',
								bytes: 0,
								size: '0',
								dead_rows_estimate: 0,
								live_rows_estimate: 0,
								replica_identity: 'Default',
								rls_enabled: false,
								rls_forced: false,
								table_kind: 'Ordinary'
							}
						],
						columns: [
							{
								class_kind: 'OrdinaryTable',
								name: 'user_id',
								number: 1,
								table_oid: 123,
								schema_name: 'public',
								table_name: 'lsp_users',
								type_id: 23,
								type_name: 'int4',
								is_nullable: false,
								is_primary_key: true,
								is_unique: true
							}
						]
					})
				);
				const schemaUri = 'file:///workspace/schema-query.sql';
				await send({
					method: 'textDocument/didOpen',
					params: {
						textDocument: {
							uri: schemaUri,
							languageId: 'postgresql',
							version: 1,
							text: 'select * from lsp_users;'
						}
					}
				});
				const completion = await request(2, 'textDocument/completion', {
					textDocument: { uri: schemaUri },
					position: { line: 0, character: 15 }
				});
				const hover = await request(3, 'textDocument/hover', {
					textDocument: { uri: schemaUri },
					position: { line: 0, character: 16 }
				});
				await handle.setSchema(null);
				const withoutSchema = await request(4, 'textDocument/completion', {
					textDocument: { uri: schemaUri },
					position: { line: 0, character: 15 }
				});
				await send({
					method: 'textDocument/didClose',
					params: { textDocument: { uri: schemaUri } }
				});
				const shutdown = await request(5, 'shutdown', null);
				handle.dispose();
				handle.dispose();
				return {
					initialize,
					invalid,
					cleared,
					completion,
					hover,
					withoutSchema,
					shutdown,
					statuses
				};
			});
			expect(result.initialize.result.serverInfo.name).toBe('pgls-wasm');
			expect(result.initialize.result.capabilities).toMatchObject({
				textDocumentSync: 1,
				hoverProvider: true
			});
			expect(result.initialize.result.capabilities.definitionProvider).toBeUndefined();
			expect(result.invalid.params).toMatchObject({
				uri: 'file:///workspace/main.sql',
				diagnostics: [
					expect.objectContaining({
						severity: 1,
						source: 'pgls',
						message: expect.stringMatching(/syntax error/)
					})
				]
			});
			expect(result.cleared.params.diagnostics).toEqual([]);
			expect(result.completion.result).toContainEqual(
				expect.objectContaining({ label: 'lsp_users' })
			);
			expect(result.hover.result.contents.value).toContain('public.lsp_users');
			expect(result.hover.result.contents.value).toContain('user_id: int4');
			expect(result.withoutSchema.result).toEqual([]);
			expect(result.shutdown).toMatchObject({ id: 5, result: null });
			expect(result.statuses.at(-1)).toEqual({ state: 'disabled' });
			expect(errors).toEqual([]);
			expect(requests).toContain('/upstream/wasm/pgls.js');
			expect(requests).toContain('/upstream/dist/pgls.wasm');
		} finally {
			await browser?.close();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
		}
	}
);
