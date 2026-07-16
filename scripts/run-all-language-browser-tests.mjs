import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	runBrowserPreparationScripts,
	startBrowserPreviewServer
} from './browser-preview-server.mjs';
import { supportMatrixRows } from './support-matrix.mjs';

const COMPRESSED_ASSET_TEST_FILE =
	'src/lib/playground/compressed-runtime-assets.playwright.test.ts';
const LSP_TEST_FILE = 'src/routes/monaco-lsp.playwright.test.ts';
const DEFAULT_PREVIEW_ORIGIN = 'http://127.0.0.1:4573';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ includeCompressedAssets?: boolean; includeLspFull?: boolean }} options
 */
export function createAllLanguageBrowserTestPlan({
	includeCompressedAssets = false,
	includeLspFull = false
} = {}) {
	/** @type {Set<string>} */
	const testFiles = new Set();
	/** @type {Record<string, string>} */
	const env = {};

	for (const row of supportMatrixRows) {
		if (!row.browserTest) continue;
		testFiles.add(row.browserTest.file);
		env[row.browserTest.env] = '1';
	}

	if (includeCompressedAssets) {
		testFiles.add(COMPRESSED_ASSET_TEST_FILE);
		env.WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS = '1';
	}
	if (includeLspFull) {
		testFiles.add(LSP_TEST_FILE);
		env.WASM_IDLE_RUN_REAL_BROWSER_LSP = '1';
	}

	return { env, testFiles: [...testFiles] };
}

/**
 * @param {{ env: Record<string, string>; testFiles: string[] }} plan
 * @param {string} browserUrl
 * @param {NodeJS.ProcessEnv} baseEnv
 */
export function createVitestChildInvocation(plan, browserUrl, baseEnv = process.env) {
	/** @type {NodeJS.ProcessEnv} */
	const childEnv = {
		...baseEnv,
		...plan.env,
		WASM_IDLE_BROWSER_URL: browserUrl,
		WASM_IDLE_BROWSER_SERVER_MODE: 'preview',
		WASM_IDLE_REUSE_LOCAL_PREVIEW: '1'
	};
	for (const key of Object.keys(childEnv)) {
		if (key.startsWith('VITEST')) delete childEnv[key];
	}
	delete childEnv.NODE_ENV;
	if (plan.env.WASM_IDLE_RUN_REAL_BROWSER_LSP === '1') {
		delete childEnv.WASM_IDLE_LSP_BROWSER_GROUPS;
		delete childEnv.WASM_IDLE_LSP_BROWSER_LANGUAGES;
	}

	return {
		command: 'pnpm',
		args: [
			'exec',
			'vitest',
			'run',
			'--no-file-parallelism',
			'--maxWorkers=1',
			...plan.testFiles
		],
		env: childEnv
	};
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 * @param {typeof spawn} spawnProcess
 */
async function runChildProcess(command, args, options, spawnProcess) {
	const child = spawnProcess(command, args, options);
	return await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code !== null) {
				resolve(code);
				return;
			}
			reject(new Error(`Vitest exited from signal ${signal || 'unknown'}`));
		});
	});
}

/** @param {string} origin */
async function startDedicatedPreviewServer(origin) {
	const previousReuseValue = process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
	delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
	try {
		return await startBrowserPreviewServer({ origin, serverMode: 'preview' });
	} finally {
		if (previousReuseValue === undefined) {
			delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
		} else {
			process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = previousReuseValue;
		}
	}
}

/**
 * @param {{ includeCompressedAssets?: boolean; includeLspFull?: boolean; origin?: string }} options
 * @param {{
 *   prepare?: typeof runBrowserPreparationScripts;
 *   spawnProcess?: typeof spawn;
 *   startPreview?: typeof startDedicatedPreviewServer;
 * }} dependencies
 */
export async function runAllLanguageBrowserTests(
	{
		includeCompressedAssets = false,
		includeLspFull = false,
		origin = DEFAULT_PREVIEW_ORIGIN
	} = {},
	{
		prepare = runBrowserPreparationScripts,
		spawnProcess = spawn,
		startPreview = startDedicatedPreviewServer
	} = {}
) {
	const plan = createAllLanguageBrowserTestPlan({
		includeCompressedAssets,
		includeLspFull
	});

	await prepare(['build:preview', 'compress:build-runtimes'], { timeoutMs: 900_000 });
	const previewServer = await startPreview(origin);
	try {
		const invocation = createVitestChildInvocation(plan, previewServer.browserUrl);
		return await runChildProcess(
			invocation.command,
			invocation.args,
			{ cwd: REPO_ROOT, env: invocation.env, stdio: 'inherit' },
			spawnProcess
		);
	} finally {
		await previewServer.close();
	}
}

/** @param {string[]} args */
export function parseAllLanguageBrowserTestArgs(args) {
	const options = {
		includeCompressedAssets: false,
		includeLspFull: false
	};

	for (const arg of args) {
		if (arg === '--include-compressed-assets') {
			options.includeCompressedAssets = true;
		} else if (arg === '--include-lsp-full') {
			options.includeLspFull = true;
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}

	return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = await runAllLanguageBrowserTests(
			parseAllLanguageBrowserTestArgs(process.argv.slice(2))
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
