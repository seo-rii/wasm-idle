// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_PYTHON === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
const timeoutMs = 300_000;
let serverPromise: ReturnType<typeof startBrowserPreviewServer> | undefined;
const require = createRequire(import.meta.url);
const pyodideVersion = '314.0.7';
const officialWheelAssets = {
	numpy: {
		fileName: 'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
		sha256: 'a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf',
		bytes: 2_960_568
	},
	jedi: {
		fileName: 'jedi-0.19.2-py2.py3-none-any.whl',
		sha256: '14346bd3f7aabb699b9e1223afdfae706f9a391212659d2cbf74c66c715095b4',
		bytes: 1_563_101
	},
	parso: {
		fileName: 'parso-0.8.6-py2.py3-none-any.whl',
		sha256: '6a4e296bc54f0e3489ce61ff9f30e9538dc382bdae10fa6413b34000883385d8',
		bytes: 106_894
	}
} as const;
type WheelPackage = keyof typeof officialWheelAssets;
type ServedWheelReceipt = {
	package: WheelPackage;
	url: string;
	status: number;
	contentType: string;
	sha256: string;
	bytes: number;
	hits: number;
};

async function verifyServedWheelAssets(
	context: BrowserContext,
	browserUrl: string,
	packages: readonly WheelPackage[]
): Promise<ServedWheelReceipt[]> {
	if (!packages.length) return [];
	const installedPackage = JSON.parse(
		await readFile(require.resolve('pyodide/package.json'), 'utf8')
	);
	expect(installedPackage.version).toBe(pyodideVersion);
	const officialLock = JSON.parse(
		await readFile(require.resolve('pyodide/pyodide-lock.json'), 'utf8')
	);
	const receipts = await Promise.all(
		packages.map(async (packageName) => {
			const asset = officialWheelAssets[packageName];
			expect(officialLock.packages[packageName]).toMatchObject({
				file_name: asset.fileName,
				sha256: asset.sha256
			});
			const url = new URL(`pyodide/${asset.fileName}`, browserUrl).href;
			const response = await context.request.get(url, { timeout: 60_000 });
			try {
				expect(response.status()).toBe(200);
				const contentType = response.headers()['content-type'] || '';
				expect(contentType.toLowerCase()).not.toContain('text/html');
				const bytes = await response.body();
				const sha256 = createHash('sha256').update(bytes).digest('hex');
				expect(sha256).toBe(asset.sha256);
				expect(bytes.length).toBe(asset.bytes);
				expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
				return {
					package: packageName,
					url,
					status: response.status(),
					contentType,
					sha256,
					bytes: bytes.length,
					hits: 0
				};
			} finally {
				await response.dispose();
			}
		})
	);
	// Register after HTTP verification so only actual runtime fetches count as hits.
	context.on('request', (request) => {
		for (const receipt of receipts) {
			if (request.url() === receipt.url) receipt.hits += 1;
		}
	});
	return receipts;
}

function assertServedWheelRequests(receipts: ServedWheelReceipt[], packages: WheelPackage[]) {
	expect(receipts.map((receipt) => receipt.package)).toEqual(packages);
	for (const receipt of receipts) {
		expect(receipt).toMatchObject({
			status: 200,
			sha256: officialWheelAssets[receipt.package].sha256,
			bytes: officialWheelAssets[receipt.package].bytes
		});
		expect(receipt.hits).toBeGreaterThan(0);
	}
	console.info(
		'Python served official wheel asset receipt',
		JSON.stringify({ pyodideVersion, packageRouting: 'default-static', receipts })
	);
}

afterAll(async () => {
	const server = await serverPromise?.catch(() => undefined);
	await server?.close();
});

async function withBrowserPreview(action: (browserUrl: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		serverPromise ??= (async () => {
			const providedUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			if (shouldReuseProvidedBrowserUrl(providedUrl)) {
				return {
					browserUrl: providedUrl,
					origin: new URL(providedUrl).origin,
					close: async () => {}
				};
			}
			await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
			return await startBrowserPreviewServer({
				origin: 'http://localhost:4593',
				serverMode: 'preview'
			});
		})();
		await action((await serverPromise).browserUrl);
	});
}

async function beginRun(page: Page, source: string) {
	await page.locator('button.action-button--run').waitFor({ state: 'visible' });
	const previousId = await page.evaluate(
		() => (globalThis as any).__wasmIdleDebug.getExecutionState().id
	);
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const accepted = await page.evaluate(
			async (code) => (globalThis as any).__wasmIdleDebug.setEditorValue(code),
			source
		);
		await page.waitForTimeout(500);
		if (
			accepted &&
			(await page.evaluate(
				(expected) => (globalThis as any).__wasmIdleDebug.getEditorValue() === expected,
				source
			))
		) {
			break;
		}
		if (attempt === 3) throw new Error('Python test source was overwritten before execution');
	}
	await page.locator('button.action-button--run').click();
	await page.waitForFunction(
		(id) => (globalThis as any).__wasmIdleDebug.getExecutionState().id > id,
		previousId
	);
}

async function withPythonBrowser(
	action: (page: Page, errors: string[], wheels: ServedWheelReceipt[]) => Promise<void>,
	wheelPackages: readonly WheelPackage[] = []
) {
	await withBrowserPreview(async (browserUrl) => {
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, browserUrl);
		await disableBrowserPrewarm(context);
		const page = await context.newPage();
		page.setDefaultTimeout(timeoutMs);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const url = new URL(browserUrl);
		url.searchParams.set('lsp-test', '1');
		try {
			const wheels = await verifyServedWheelAssets(context, browserUrl, wheelPackages);
			await page.goto(url.href, { waitUntil: 'domcontentloaded' });
			await page.evaluate(() => localStorage.clear());
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				if (
					await page.evaluate(
						() => crossOriginIsolated && !!navigator.serviceWorker?.controller
					)
				)
					break;
				await page.evaluate(async () => {
					await navigator.serviceWorker.ready;
				});
			}
			await page.waitForFunction(
				() => crossOriginIsolated && !!(globalThis as any).__wasmIdleDebug?.setEditorValue
			);
			await page.locator('#language-select').selectOption('PYTHON');
			await page.waitForFunction(
				() =>
					(document.querySelector('#language-select') as HTMLSelectElement)?.value ===
						'PYTHON' &&
					Array.from(document.querySelectorAll('.file-tabs button')).some((button) =>
						button.textContent?.includes('main.py')
					)
			);
			if (errors.length) {
				throw new Error(`Python browser initialization failed: ${errors.join('\n')}`);
			}
			await page.waitForFunction(() => {
				const hooks = globalThis as any;
				const editor = hooks.__wasmIdleMonacoEditor;
				const model = editor?.getModel();
				return (
					model?.getLanguageId() === 'python' &&
					String(model.uri).endsWith('/main.py') &&
					hooks.__wasmIdleDebug.getEditorValue() === editor.getValue()
				);
			});
			await action(page, errors, wheels);
		} finally {
			await browser.close();
		}
	});
}

describe.skipIf(!enabled)('real Python 3.14 browser runtime', () => {
	it(
		'executes Python 3.14 syntax, bundled standard libraries, and terminal stdin',
		{ timeout: 1_200_000, meta: browserMeta },
		async () => {
			await withBrowserPreview(async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					language: 'PYTHON',
					runTimeoutMs: timeoutMs,
					expectedOutput: 'main=73',
					stdinText: '68\n',
					source: `import sys, sqlite3, lzma
from compression import zstd
print("python=" + ".".join(map(str, sys.version_info[:3])))
template = t"{int(input()) + 5}"
db = sqlite3.connect(":memory:")
assert db.execute("SELECT 40 + 2").fetchone()[0] == 42
assert lzma.decompress(lzma.compress(b"stdlib")) == b"stdlib"
assert zstd.decompress(zstd.compress(b"stdlib")) == b"stdlib"
print("stdlib=sqlite3,lzma,zstd")
print(f"main={template.values[0]}")`
				});
				expect(summary.transcript).toContain('python=3.14.2');
				expect(summary.transcript).toContain('stdlib=sqlite3,lzma,zstd');
				expect(summary.pageErrors).toEqual([]);
				expect(
					summary.runtimeRequests.some((url) =>
						new URL(url).pathname.endsWith('/pyodide.asm.mjs')
					)
				).toBe(true);
				expect(
					summary.runtimeRequests.some((url) =>
						new URL(url).pathname.endsWith('/pyodide.asm.js')
					)
				).toBe(false);
			});
		}
	);

	it(
		'loads the NumPy Python 3.14 ABI from default served package assets',
		{ timeout: 1_200_000, meta: browserMeta },
		async () => {
			await withPythonBrowser(
				async (page, errors, wheels) => {
					await beginRun(
						page,
						'import numpy as np\nprint(f"numpy-version={np.__version__}")\nprint(f"numpy={np.arange(6, dtype=np.int64).sum()}")'
					);
					await page.waitForFunction(
						() =>
							(globalThis as any).__wasmIdleDebug.getExecutionState().endedAt !== null
					);
					expect(
						await page.evaluate(() =>
							(globalThis as any).__wasmIdleDebug.getExecutionState()
						)
					).toMatchObject({ status: 'completed', exitCode: 0 });
					const transcript = await page
						.locator('[data-testid="terminal-debug-output"]')
						.textContent();
					expect(transcript).toContain('numpy-version=2.4.6');
					expect(transcript).toContain('numpy=15');
					expect(errors).toEqual([]);
					assertServedWheelRequests(wheels, ['numpy']);
				},
				['numpy']
			);
		}
	);

	it(
		'interrupts an infinite Python loop and runs another program afterward',
		{ timeout: 1_200_000, meta: browserMeta },
		async () => {
			await withPythonBrowser(async (page, errors) => {
				await beginRun(page, 'print("loop-ready")\nwhile True:\n    pass');
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('loop-ready')
				);
				await page.locator('button.action-button--stop').first().click({ timeout: 5000 });
				await page.waitForFunction(
					() => (globalThis as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(
						() => (globalThis as any).__wasmIdleDebug.getExecutionState().status
					)
				).toBe('cancelled');
				await beginRun(
					page,
					'import sys\nprint(f"recovered={sys.version_info.major}.{sys.version_info.minor}")'
				);
				await page.waitForFunction(
					() => (globalThis as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() =>
						(globalThis as any).__wasmIdleDebug.getExecutionState()
					)
				).toMatchObject({ status: 'completed', exitCode: 0 });
				expect(
					await page.locator('[data-testid="terminal-debug-output"]').textContent()
				).toContain('recovered=3.14');
				expect(errors).toEqual([]);
			});
		}
	);

	it(
		'provides Python Monaco completion and diagnostics from default served Jedi assets',
		{ timeout: 1_200_000, meta: browserMeta },
		async () => {
			await withPythonBrowser(
				async (page, errors, wheels) => {
					await page.locator('#lsp-toggle').check();
					await page.waitForFunction(() => {
						const status = (globalThis as any).__wasmIdleMonacoLspStatus?.python;
						if (status?.state === 'error') throw new Error(status.message);
						return status?.state === 'ready';
					});
					await page.evaluate(() => {
						const editor = (globalThis as any).__wasmIdleMonacoEditor;
						editor.setValue('import math\nmath.si');
						editor.setPosition({ lineNumber: 2, column: 8 });
						editor.focus();
					});
					await page.waitForFunction(
						() =>
							(globalThis as any).__wasmIdleMonacoEditor?.getValue() ===
							'import math\nmath.si'
					);
					await page.waitForTimeout(500);
					await page.evaluate(() =>
						(globalThis as any).__wasmIdleMonacoEditor.trigger(
							'python-browser-regression',
							'editor.action.triggerSuggest',
							{}
						)
					);
					await page
						.locator('.suggest-widget.visible .label-name')
						.filter({ hasText: /^sin$/u })
						.first()
						.waitFor({ timeout: 30_000 });
					await page.keyboard.press('Escape');
					await page.evaluate(() =>
						(globalThis as any).__wasmIdleMonacoEditor.setValue(
							'def broken(:\n    pass\n'
						)
					);
					await page.waitForFunction(() => {
						const hooks = globalThis as any;
						return hooks.__wasmIdleMonacoApi.editor
							.getModelMarkers({
								resource: hooks.__wasmIdleMonacoEditor.getModel().uri
							})
							.some(
								(marker: any) =>
									marker.startLineNumber === 1 && marker.severity >= 4
							);
					});
					await page.evaluate(() =>
						(globalThis as any).__wasmIdleMonacoEditor.setValue(
							'template = t"{40 + 2}"\n'
						)
					);
					await page.waitForFunction(() => {
						const hooks = globalThis as any;
						return (
							hooks.__wasmIdleMonacoEditor.getValue() ===
								'template = t"{40 + 2}"\n' &&
							hooks.__wasmIdleMonacoApi.editor.getModelMarkers({
								resource: hooks.__wasmIdleMonacoEditor.getModel().uri
							}).length === 0
						);
					});
					expect(errors).toEqual([]);
					assertServedWheelRequests(wheels, ['jedi', 'parso']);
				},
				['jedi', 'parso']
			);
		}
	);
});
