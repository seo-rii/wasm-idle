import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
	ALL_BROWSER_FAMILIES,
	runtimeBrowserFamiliesForSource
} from './runtime-browser-registry.mjs';

const PLAYGROUND_MODULE_FAMILIES = new Map();
for (const [family, modules] of Object.entries({
	clang: [
		'cachedClang',
		'assetBridge',
		'compiledArtifactCache',
		'worker/cachedClangCompile',
		'worker/cachedClangExecute',
		'cpp-standards',
		'long-double'
	],
	debug: ['lldbSession', 'lldbManifest', 'wasmDebugVersion', 'debug'],
	workspace: [
		'cachedClang',
		'clangAssetIntegrity',
		'clangStreamingPolicy',
		'clangWorkerProtocol',
		'assetBridge',
		'compiledArtifactCache',
		'clang-runtime-bundle',
		'worker/clang',
		'worker/cachedClangCompile',
		'worker/cachedClangExecute',
		'worker/clangStreaming',
		'python',
		'pythonPackageLock',
		'worker/python',
		'worker/pythonExecution',
		'worker/pythonStdio',
		'worker/pythonDebugPreview',
		'worker/pythonWorkspaceFiles',
		'worker/pythonWorkspaceImports'
	],
	nim: ['wasm-nim-runner-worker', 'wasm-nim-lifecycle'],
	esolangs: ['wasiInterpreters', 'worker/wasiInterpreters', 'esolangs', 'wasm', 'worker/wasm']
})) {
	for (const module of modules) {
		const families = PLAYGROUND_MODULE_FAMILIES.get(module) || [];
		PLAYGROUND_MODULE_FAMILIES.set(module, [...families, family]);
	}
}
for (const module of [
	'index',
	'sandbox',
	'runtimeSession',
	'runtimeAssetCache',
	'assets',
	'worker/assets',
	'sharedBuffer',
	'workerSession',
	'workerProgress',
	'worker/stdinPipe',
	'stdin'
]) {
	PLAYGROUND_MODULE_FAMILIES.set(module, ALL_BROWSER_FAMILIES);
}
PLAYGROUND_MODULE_FAMILIES.set('runtime-recovery', ['dotnet', 'nim']);
for (const module of [
	'staticWorkerRuntime',
	'staticStdinRing',
	'staticRuntimePreflight',
	'staticRuntimePreflightExecute',
	'staticRuntimePreflightProtocol',
	'worker/staticRuntimePreflight'
]) {
	PLAYGROUND_MODULE_FAMILIES.set(module, ['nim', 'specialized', 'workers']);
}

// Cross-runtime helpers and non-language suites complement the source registry.
const RUNTIME_DIRECTORIES = {
	workspace: ['packages/llvm-core/', 'static/clang/', 'runtimes/pyodide/', 'static/pyodide/'],
	debug: ['packages/debug/', 'static/wasm-debug/'],
	esolangs: ['runtimes/esolangs/']
};
const RUNTIME_SCRIPT_FAMILIES = {
	workspace: [
		'sync-wasm-clang',
		'prepare-clangd-assets',
		'clang-cpp-headers.lock',
		'clang-resource-headers.lock',
		'sync-pyodide',
		'python-package-lock'
	],
	clang: ['prepare-clangd-assets', 'clang-cpp-headers.lock', 'clang-resource-headers.lock'],
	debug: [
		'sync-wasm-debug',
		'prepare-wasm-debug-release',
		'verify-page-wasm-debug',
		'wasm-debug-release.v2'
	],
	esolangs: ['build-esolang-runtimes']
};

/** @param {string[]} files */
export function changedBrowserFamilies(files) {
	const families = new Set();
	for (const file of files) {
		/** @type {Set<string>} */
		const fileFamilies = new Set(runtimeBrowserFamiliesForSource(file));
		if (
			/^src\/routes\/(?:workspace[^/]*|debugger-toolbar-layout\.playwright\.test)\.ts$/.test(
				file
			)
		) {
			families.add('workspace');
			continue;
		}
		const playgroundModule = file.match(/^src\/lib\/playground\/(.+?)\.(?:[^/]+\.)?ts$/)?.[1];
		for (const family of PLAYGROUND_MODULE_FAMILIES.get(playgroundModule) || [])
			fileFamilies.add(family);
		for (const [family, directories] of Object.entries(RUNTIME_DIRECTORIES)) {
			if (directories.some((directory) => file.startsWith(directory)))
				fileFamilies.add(family);
		}
		const script = file.match(
			/^scripts\/(?:runtime-workers\/)?([^/]+?)(?:\.test)?\.(?:mjs|js|json)$/
		)?.[1];
		for (const [family, scripts] of Object.entries(RUNTIME_SCRIPT_FAMILIES)) {
			if (script && scripts.includes(script)) fileFamilies.add(family);
		}
		if (
			/^(src\/routes\/|packages\/(core|terminal|llvm-core)\/|scripts\/(stdin-browser|run-all-language|changed-browser|runtime-browser|browser-preview|required-browser|browser-test|prepare-browser-test|support-matrix)|\.github\/workflows\/|(?:package\.json|pnpm-lock\.yaml|vite\.config\.ts|vitest\.config\.ts|sveltekit\.config\.mjs)$)/.test(
				file
			) ||
			// Cover the runtime ownership shapes even before a source name is registered.
			(fileFamilies.size === 0 &&
				/^(runtimes\/[^/]+\/|producers\/|static\/[^/]+\/|src\/lib\/playground\/|scripts\/(?:[^/]+-|llvm-contracts\/))/.test(
					file
				))
		) {
			for (const family of ALL_BROWSER_FAMILIES) fileFamilies.add(family);
		}
		for (const family of fileFamilies) families.add(family);
	}
	return [...families].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const base = process.argv[2];
	const files =
		!base || /^0+$/.test(base)
			? ['package.json']
			: execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
					.trim()
					.split('\n');
	const families = changedBrowserFamilies(files);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `families=${JSON.stringify(families)}\n`);
	console.log(JSON.stringify(families));
}
