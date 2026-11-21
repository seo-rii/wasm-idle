import { PHP_PRELOAD, PHP_PRELOAD_PATH, PHP_STDIN_MESSAGE } from './phpPreload';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import type { RuntimeAssetCacheOptions } from '@wasm-idle/core';
import { createModuleAssetFetch } from './moduleAssetCache';

// The runtime loader reads the global fetch at call time; each load installs the cached
// variant over the fetch this Worker started with.
let networkFetch: typeof fetch | undefined;

declare var self: any;

let runtimeModuleUrl = '';
let phpPromise: Promise<PhpRuntime> | null = null;
let workspaceDirty = false;

// A superseded attempt must not send errors to a newer load or run's listener.
class SupersededPhpStartup extends Error {}

interface PhpRuntime {
	exit?(): void;
	onMessage(handler: (message: string) => string): () => Promise<void> | void;
	mkdir(path: string): void;
	rmdir(path: string, options?: { recursive?: boolean }): void;
	writeFile(path: string, content: string): void;
	run(options: Record<string, unknown>): Promise<{
		text: string;
		errors: string;
		exitCode: number;
	}>;
}

function disposePhp(php: PhpRuntime) {
	try {
		php.exit?.();
	} catch {
		// Preserve the startup failure or replacement that triggered cleanup.
	}
}

interface PhpRuntimeModule {
	createPhp84(): Promise<PhpRuntime>;
}

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

async function loadPhp(moduleUrl: string, log = true) {
	if (!moduleUrl) throw new Error('PHP runtime module URL is not configured.');
	if (runtimeModuleUrl !== moduleUrl) {
		const previous = phpPromise;
		runtimeModuleUrl = moduleUrl;
		phpPromise = null;
		workspaceDirty = false;
		void previous?.then(disposePhp, () => {});
	}
	if (phpPromise) return await phpPromise;
	const operation = Promise.resolve().then(async () => {
		let php: PhpRuntime | undefined;
		try {
			postProgress(5);
			const runtime = await importRuntimeModule<PhpRuntimeModule>(moduleUrl);
			if (phpPromise !== operation || runtimeModuleUrl !== moduleUrl) {
				throw new SupersededPhpStartup('PHP runtime startup was superseded.');
			}
			php = await runtime.createPhp84();
			if (phpPromise !== operation || runtimeModuleUrl !== moduleUrl) {
				throw new SupersededPhpStartup('PHP runtime startup was superseded.');
			}
			postProgress(95);
			php.mkdir('/workspace');
			php.writeFile(PHP_PRELOAD_PATH, PHP_PRELOAD);
			if (log) {
				console.log('[wasm-idle:php-worker] PHP 8.4 ready');
			}
			postProgress(100);
			return php;
		} catch (error) {
			if (php) disposePhp(php);
			throw error;
		}
	});
	phpPromise = operation;
	try {
		return await operation;
	} catch (error) {
		// Failed speculative startup must not poison the later explicit Run.
		// A stale attempt must never clear a newer configuration's runtime.
		if (phpPromise !== operation)
			throw new SupersededPhpStartup('PHP runtime startup was superseded.');
		phpPromise = null;
		throw error;
	}
}

function prepareWorkspace(php: PhpRuntime) {
	if (workspaceDirty) {
		php.rmdir('/workspace', { recursive: true });
		php.mkdir('/workspace');
	}
	workspaceDirty = true;
}

function normalizeWorkspacePath(path: string) {
	return path
		.replace(/^\/+/, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'))
		.join('/');
}

function dirname(path: string) {
	const slashIndex = path.lastIndexOf('/');
	return slashIndex === -1 ? '' : path.slice(0, slashIndex);
}

function mkdirp(php: PhpRuntime, path: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	let current = '';
	for (const part of normalized.split('/')) {
		current += `/${part}`;
		try {
			php.mkdir(current);
		} catch {
			// Existing directories throw from the Emscripten FS API.
		}
	}
}

function writeWorkspaceFile(php: PhpRuntime, path: string, content: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	const fullPath = `/workspace/${normalized}`;
	mkdirp(php, dirname(`workspace/${normalized}`));
	php.writeFile(fullPath, content);
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.php',
		workspaceFiles = [],
		log,
		persistentCache
	} = event.data;
	try {
		if (load) {
			const moduleUrl = nextModuleUrl || runtimeModuleUrl;
			if (log) console.log(`[wasm-idle:php-worker] load PHP 8.4 module=${moduleUrl}`);
			networkFetch ??= globalThis.fetch.bind(globalThis);
			globalThis.fetch = createModuleAssetFetch(
				moduleUrl,
				'wasm-php',
				persistentCache as RuntimeAssetCacheOptions | undefined,
				networkFetch
			);
			await loadPhp(moduleUrl, log);
			postMessage({ load: true });
			return;
		}

		const inputBuffer = new Int32Array(buffer);
		const php = await loadPhp(runtimeModuleUrl, log);

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		prepareWorkspace(php);
		for (const file of workspaceFiles as SandboxWorkspaceFile[]) {
			await writeWorkspaceFile(php, file.path, file.content);
		}
		const normalizedActivePath = normalizeWorkspacePath(activePath) || 'main.php';
		const scriptPath = `/workspace/${normalizedActivePath}`;
		writeWorkspaceFile(php, normalizedActivePath, code);

		if (log) {
			console.log(
				`[wasm-idle:php-worker] run start bytes=${code.length} activePath=${activePath}`
			);
		}
		postMessage({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'PHP program started'
			}
		});
		const interactive = typeof stdin !== 'string';
		const removeInputHandler = interactive
			? php.onMessage((message) => {
					if (message !== PHP_STDIN_MESSAGE) return '';
					const chunk = waitForBufferedStdin(inputBuffer, () =>
						postMessage({ buffer: true })
					);
					return JSON.stringify(chunk);
				})
			: undefined;
		let response;
		try {
			response = await php.run({
				scriptPath,
				body: interactive ? '' : stdin,
				env: { USER: 'jungol' },
				$_SERVER: {
					WASM_IDLE_ARGV: JSON.stringify([normalizedActivePath, ...args]),
					WASM_IDLE_TERMINAL_STDIN: interactive ? '1' : '0',
					SCRIPT_FILENAME: scriptPath,
					SCRIPT_NAME: `/${normalizedActivePath}`
				}
			});
		} finally {
			await removeInputHandler?.();
		}
		if (response.text) postMessage({ output: response.text });
		if (response.errors) postMessage({ output: response.errors });
		if (response.exitCode !== 0) {
			// response.errors was already posted as output above.
			throw new Error(`PHP program exited with code ${response.exitCode}`);
		}
		if (log) {
			console.log(`[wasm-idle:php-worker] run settled exitCode=${response.exitCode}`);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (error instanceof SupersededPhpStartup) return;
		if (log) {
			console.error('[wasm-idle:php-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
