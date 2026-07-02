import { expect, test } from '@playwright/test';

test('browser-native harness executes hello, yojson, and diagnostics fixtures', async ({
	context,
	page
}) => {
	const binaryenBridgeRequests: Array<{ method: string; url: string }> = [];
	const binaryenBridgeResponses: Array<{ status: number; url: string }> = [];
	const binaryenToolRequests: Array<{ method: string; url: string }> = [];
	const binaryenToolResponses: Array<{ status: number; url: string }> = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/binaryen-command')) {
			binaryenBridgeRequests.push({
				method: request.method(),
				url: request.url()
			});
		}
		if (
			request.url().includes('/tools/wasm-opt.browser.js') ||
			request.url().includes('/tools/wasm-merge.browser.js') ||
			request.url().includes('/tools/wasm-metadce.browser.js')
		) {
			binaryenToolRequests.push({
				method: request.method(),
				url: request.url()
			});
		}
	});
	page.on('response', (response) => {
		if (response.url().includes('/api/binaryen-command')) {
			binaryenBridgeResponses.push({
				status: response.status(),
				url: response.url()
			});
		}
		if (
			response.url().includes('/tools/wasm-opt.browser.js') ||
			response.url().includes('/tools/wasm-merge.browser.js') ||
			response.url().includes('/tools/wasm-metadce.browser.js')
		) {
			binaryenToolResponses.push({
				status: response.status(),
				url: response.url()
			});
		}
	});

	await context.addCookies([
		{
			name: 'dev_bypass_waf',
			value: 'seorii_bypass_token_is_this',
			domain: '127.0.0.1',
			path: '/'
		}
	]);

	await page.goto('/');

	await expect
		.poll(async () => await page.locator('#status').textContent(), {
			timeout: 180_000,
			message: 'expected browser-native harness to finish successfully'
		})
		.toBe('Browser-native compile succeeded.');

	const outputText = await page.locator('#output').textContent();
	expect(outputText).toBeTruthy();

	const output = JSON.parse(outputText || '{}') as {
		hello: {
			js: {
				success: boolean;
				artifacts: Array<{ path: string; size: number }>;
				runtimeOutput: string[];
			};
			wasm: {
				success: boolean;
				stderr: string;
				artifacts: Array<{ path: string; size: number }>;
				runtimeOutput: string[];
			};
		};
		packages: {
			yojson: {
				js: {
					success: boolean;
					artifacts: Array<{ path: string; size: number }>;
					runtimeOutput: string[];
				};
				wasm: {
					success: boolean;
					stderr: string;
					artifacts: Array<{ path: string; size: number }>;
					runtimeOutput: string[];
				};
			};
		};
		diagnostics: {
			type_error: {
				success: boolean;
				stage: string;
				diagnostics: Array<{
					file?: string;
					severity: string;
					message: string;
				}>;
			};
		};
	};

	expect(output.hello.js.success).toBe(true);
	expect(output.hello.wasm.success).toBe(true);
	expect(output.hello.js.artifacts.some((artifact) => artifact.path.endsWith('/hello.js'))).toBe(
		true
	);
	expect(
		output.hello.wasm.artifacts.some((artifact) => artifact.path.endsWith('/hello.js'))
	).toBe(true);
	expect(output.hello.wasm.artifacts.some((artifact) => artifact.path.endsWith('.wasm'))).toBe(
		true
	);
	expect(output.hello.wasm.stderr).not.toContain('binaryen bridge exit: 0');
	expect(output.hello.wasm.stderr).not.toContain('binaryen bridge http');
	expect(
		output.hello.wasm.runtimeOutput.some((line) =>
			line.startsWith('asset resolve: hello.assets/')
		)
	).toBe(true);
	expect(output.hello.wasm.runtimeOutput).toContain('wasm instantiateStreaming');
	expect(output.hello.wasm.runtimeOutput).toContain('runtime promise resolved');
	expect(output.hello.js.runtimeOutput).toContain('hello from wasm_of_js_of_ocaml');

	expect(output.packages.yojson.js.success).toBe(true);
	expect(output.packages.yojson.wasm.success).toBe(true);
	expect(
		output.packages.yojson.js.artifacts.some((artifact) =>
			artifact.path.endsWith('/yojson_main.js')
		)
	).toBe(true);
	expect(
		output.packages.yojson.wasm.artifacts.some((artifact) =>
			artifact.path.endsWith('/yojson_main.js')
		)
	).toBe(true);
	expect(
		output.packages.yojson.wasm.artifacts.some((artifact) => artifact.path.endsWith('.wasm'))
	).toBe(true);
	expect(output.packages.yojson.wasm.stderr).not.toContain('binaryen bridge exit: 0');
	expect(output.packages.yojson.wasm.stderr).not.toContain('binaryen bridge http');
	expect(
		output.packages.yojson.js.runtimeOutput.some((line) => line.includes('{"hello":1}'))
	).toBe(true);
	expect(
		output.packages.yojson.wasm.runtimeOutput.some((line) => line.includes('{"hello":1}'))
	).toBe(true);

	expect(output.diagnostics.type_error.success).toBe(false);
	expect(output.diagnostics.type_error.stage).toBe('ocamlc');
	expect(output.diagnostics.type_error.diagnostics.length).toBeGreaterThan(0);
	expect(output.diagnostics.type_error.diagnostics[0]?.file).toBe('type_error.ml');
	expect(output.diagnostics.type_error.diagnostics[0]?.severity).toBe('error');
	expect(output.diagnostics.type_error.diagnostics[0]?.message).toMatch(/string|int/i);

	expect(binaryenBridgeRequests).toEqual([]);
	expect(binaryenBridgeResponses).toEqual([]);
	expect(binaryenToolRequests.length).toBeGreaterThan(0);
	expect(binaryenToolResponses.length).toBeGreaterThan(0);
	expect(binaryenToolRequests.every((request) => request.method === 'GET')).toBe(true);
	const binaryenToolPaths = binaryenToolRequests.map((request) => new URL(request.url).pathname);
	expect(binaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-merge.browser.js'))).toBe(
		true
	);
	expect(binaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-opt.browser.js'))).toBe(
		false
	);
	expect(
		binaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-metadce.browser.js'))
	).toBe(false);
	expect(
		binaryenToolRequests.every((request) =>
			new URL(request.url).pathname.startsWith('/.cache/browser-native-bundle/tools/')
		)
	).toBe(true);
	expect(binaryenToolResponses.every((response) => response.status === 200)).toBe(true);

	binaryenToolRequests.length = 0;
	binaryenToolResponses.length = 0;
	const fullBinaryenResult = await page.evaluate(async () => {
		const compilerModule = await import('/browser-harness/dist/src/index.js');
		const manifest = await compilerModule.fetchBrowserNativeManifest();
		const source = await fetch('/fixtures/hello/hello.ml', { cache: 'no-store' }).then(
			(response) => response.text()
		);
		const result = await compilerModule.compile(
			{
				files: {
					'hello.ml': source
				},
				entry: 'hello.ml',
				target: 'wasm',
				wasmBinaryenMode: 'full'
			},
			{
				system: compilerModule.createBrowserWorkerSystemDispatcher({ manifest }),
				toolchainRoot: '/static/toolchain'
			}
		);
		return {
			success: result.success,
			stderr: result.stderr,
			wasmSizes: result.artifacts
				.filter((artifact) => artifact.path.endsWith('.wasm'))
				.map((artifact) =>
					typeof artifact.data === 'string'
						? new TextEncoder().encode(artifact.data).byteLength
						: artifact.data.byteLength
				)
		};
	});
	expect(fullBinaryenResult.success, fullBinaryenResult.stderr).toBe(true);
	expect(fullBinaryenResult.wasmSizes.some((size) => size < 20_000)).toBe(true);
	const fullBinaryenToolPaths = binaryenToolRequests.map(
		(request) => new URL(request.url).pathname
	);
	expect(
		fullBinaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-merge.browser.js'))
	).toBe(true);
	expect(
		fullBinaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-opt.browser.js'))
	).toBe(true);
	expect(
		fullBinaryenToolPaths.some((pathname) => pathname.endsWith('/wasm-metadce.browser.js'))
	).toBe(true);
});
