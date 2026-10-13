import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALL_BROWSER_FAMILIES = [
	'clang',
	'debug',
	'dotnet',
	'esolangs',
	'go',
	'nim',
	'python',
	'workspace'
];
const PLAYGROUND_MODULE_FAMILIES = new Map();
for (const [family, modules] of Object.entries({
	clang: [
		'clang',
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
		'objectivec',
		'worker/objectivec',
		'wasmObjectiveCVersion',
		'objectivec-assets',
		'objectivecxx',
		'cpp-standards',
		'long-double'
	],
	debug: ['lldbSession', 'debug'],
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
	dotnet: [
		'dotnet',
		'worker/dotnet',
		'worker/dotnet-prepare',
		'dotnet-switch',
		'wasmDotnetVersion'
	],
	nim: [
		'nim',
		'worker/nim',
		'wasmNimVersion',
		'wasm-nim-runner-worker',
		'wasm-nim-lifecycle',
		'staticWorkerRuntime',
		'staticStdinRing'
	],
	go: ['go', 'worker/go'],
	python: [
		'python',
		'pythonPackageLock',
		'worker/python',
		'worker/pythonExecution',
		'worker/pythonStdio',
		'worker/pythonDebugPreview',
		'worker/pythonWorkspaceFiles',
		'worker/pythonWorkspaceImports'
	],
	esolangs: [
		'aheui',
		'worker/aheui',
		'apecode',
		'worker/apecode',
		'golfscript',
		'worker/golfscript',
		'worker/golfscriptMount',
		'ruby',
		'worker/ruby',
		'rubyAssets',
		'wasmAheuiVersion',
		'wasmApecodeVersion',
		'wasmGolfscriptVersion',
		'wasiInterpreters',
		'worker/wasiInterpreters',
		'esolangs',
		'wasm',
		'worker/wasm',
		'python',
		'worker/python',
		'worker/pythonExecution',
		'worker/pythonStdio'
	]
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

const RUNTIME_DIRECTORIES = {
	workspace: ['packages/llvm-core/', 'static/clang/', 'runtimes/pyodide/', 'static/pyodide/'],
	clang: ['packages/llvm-core/', 'static/clang/', 'static/wasm-objectivec/'],
	debug: ['packages/debug/', 'static/wasm-debug/'],
	dotnet: ['runtimes/wasm-dotnet/', 'static/wasm-dotnet/'],
	nim: ['runtimes/wasm-nim/', 'static/wasm-nim/'],
	go: ['runtimes/wasm-go/', 'static/wasm-go/'],
	python: ['runtimes/pyodide/', 'static/pyodide/'],
	esolangs: [
		'runtimes/esolangs/',
		'runtimes/ruby/',
		...[
			'brainfuck',
			'befunge93',
			'whitespace',
			'malbolge',
			'aheui',
			'uhmlang',
			'lolcode',
			'apecode',
			'golfscript',
			'ruby'
		].map((runtime) => `static/wasm-${runtime}/`)
	]
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
	clang: [
		'sync-wasm-clang',
		'sync-wasm-objectivec',
		'prepare-clangd-assets',
		'clang-cpp-headers.lock',
		'clang-resource-headers.lock'
	],
	debug: [
		'sync-wasm-debug',
		'prepare-wasm-debug-release',
		'verify-page-wasm-debug',
		'wasm-debug-release.v2'
	],
	dotnet: ['sync-wasm-dotnet', 'wasm-dotnet-runner-worker'],
	nim: ['sync-wasm-nim', 'wasm-nim-runner-worker', 'wasm-nim-assets.lock'],
	go: ['sync-wasm-go', 'go-browser-probe-lib', 'probe-go-browser'],
	python: ['sync-pyodide', 'python-package-lock'],
	esolangs: [
		'build-esolang-runtimes',
		'sync-wasm-aheui',
		'sync-wasm-apecode',
		'sync-wasm-golfscript'
	]
};

/** @param {string[]} files */
export function changedBrowserFamilies(files) {
	const families = new Set();
	for (const file of files) {
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
			families.add(family);
		for (const [family, directories] of Object.entries(RUNTIME_DIRECTORIES)) {
			if (directories.some((directory) => file.startsWith(directory))) families.add(family);
		}
		const script = file.match(
			/^scripts\/(?:runtime-workers\/)?([^/]+?)(?:\.test)?\.(?:mjs|js|json)$/
		)?.[1];
		for (const [family, scripts] of Object.entries(RUNTIME_SCRIPT_FAMILIES)) {
			if (script && scripts.includes(script)) families.add(family);
		}
		if (
			/^(src\/routes\/|packages\/(core|terminal)\/|scripts\/(stdin-browser|run-all-language|changed-browser|browser-preview|required-browser|browser-test|prepare-browser-test|support-matrix)|\.github\/workflows\/|(?:package\.json|pnpm-lock\.yaml|vite\.config\.ts|vitest\.config\.ts|sveltekit\.config\.mjs)$)/.test(
				file
			)
		) {
			for (const family of ALL_BROWSER_FAMILIES) families.add(family);
		}
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
