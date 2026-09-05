import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRuntimeDir = resolve(root, 'dist/runtime');
const aotCompilerAssemblies = [
	'Microsoft.CodeAnalysis.wasm',
	'Microsoft.CodeAnalysis.CSharp.wasm',
	'Microsoft.CodeAnalysis.VisualBasic.wasm'
];

export async function patchRuntime({
	runtimeDir = defaultRuntimeDir,
	compilerAssemblies = aotCompilerAssemblies
} = {}) {
	const workerPolyfillPath = resolve(runtimeDir, 'dotnet.native.worker.polyfill.mjs');
	const bootPath = resolve(runtimeDir, 'blazor.boot.json');
	const boot = JSON.parse(await readFile(bootPath, 'utf8'));
	const usesPthreads = Boolean(boot.resources?.jsModuleWorker);

	await rm(workerPolyfillPath, { force: true });
	if (usesPthreads) {
		// .NET's sidecar replacement identifies this host worker as the runtime's
		// main thread. Emscripten must read the replacement after it is initialized;
		// otherwise Mono attaches the host as a pthread with no worker event target.
		const nativePath = resolve(runtimeDir, 'dotnet.native.js');
		const nativeSource = await readFile(nativePath, 'utf8');
		const before =
			'ENVIRONMENT_IS_WORKER=dotnet_replacements.ENVIRONMENT_IS_WORKER;Module.__dotnet_runtime.initializeReplacements(dotnet_replacements);';
		const after =
			'Module.__dotnet_runtime.initializeReplacements(dotnet_replacements);ENVIRONMENT_IS_WORKER=dotnet_replacements.ENVIRONMENT_IS_WORKER;';
		if (!nativeSource.includes(before) && !nativeSource.includes(after)) {
			throw new Error('Unsupported .NET pthread initialization in dotnet.native.js');
		}
		const patchedNativeSource = nativeSource.replace(before, after);
		await writeFile(nativePath, patchedNativeSource, 'utf8');
		boot.resources.jsModuleNative['dotnet.native.js'] =
			`sha256-${createHash('sha256').update(patchedNativeSource).digest('base64')}`;
		boot.pthreadPoolInitialSize = Math.max(boot.pthreadPoolInitialSize || 0, 8);
		boot.pthreadPoolUnusedSize = Math.max(boot.pthreadPoolUnusedSize || 0, 8);
	} else {
		delete boot.pthreadPoolInitialSize;
		delete boot.pthreadPoolUnusedSize;
	}
	const compilerAssemblyGroup = usesPthreads ? 'coreAssembly' : 'assembly';
	boot.resources[compilerAssemblyGroup] ??= {};
	for (const name of compilerAssemblies) {
		for (const source of ['assembly', 'coreAssembly', 'lazyAssembly']) {
			const hash = boot.resources[source]?.[name];
			if (!hash) continue;
			boot.resources[compilerAssemblyGroup][name] = hash;
			if (source !== compilerAssemblyGroup) {
				delete boot.resources[source][name];
			}
		}
	}
	if (boot.resources.lazyAssembly && Object.keys(boot.resources.lazyAssembly).length === 0) {
		delete boot.resources.lazyAssembly;
	}
	await writeFile(bootPath, `${JSON.stringify(boot, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await patchRuntime({
		runtimeDir: process.argv[2] ? resolve(process.argv[2]) : defaultRuntimeDir
	});
}
