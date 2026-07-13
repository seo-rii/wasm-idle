import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);

export const RUNTIMES = [
	{
		name: 'wasm-clang',
		module: './sync-wasm-clang.mjs',
		exportName: 'syncWasmClangDist',
		sourceArg: 'sourceDir',
		targetArg: 'staticDir'
	},
	{
		name: 'wasm-rust',
		module: './sync-wasm-rust.mjs',
		exportName: 'syncWasmRustDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-go',
		module: './sync-wasm-go.mjs',
		exportName: 'syncWasmGoDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-d',
		module: './sync-wasm-d.mjs',
		exportName: 'syncWasmDDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-typescript',
		module: './sync-wasm-typescript.mjs',
		exportName: 'syncWasmTypeScriptDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-wat',
		module: './sync-wasm-wat.mjs',
		exportName: 'syncWasmWatDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-lua',
		module: './sync-wasm-lua.mjs',
		exportName: 'syncWasmLuaDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-zig',
		module: './sync-wasm-zig.mjs',
		exportName: 'syncWasmZigAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-haskell',
		module: './sync-wasm-haskell.mjs',
		exportName: 'syncWasmHaskellAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-lisp',
		module: './sync-wasm-lisp.mjs',
		exportName: 'syncWasmLispDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-dotnet',
		module: './sync-wasm-dotnet.mjs',
		exportName: 'syncWasmDotnetDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-tinygo',
		module: './sync-wasm-tinygo.mjs',
		exportName: 'syncWasmTinyGoDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-swift',
		module: './sync-wasm-swift.mjs',
		exportName: 'syncWasmSwiftAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir',
		manual: true
	},
	{
		name: 'wasm-elixir',
		module: './sync-wasm-elixir.mjs',
		exportName: 'syncWasmElixirDist',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'webr',
		module: './sync-webr.mjs',
		exportName: 'syncWebRAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-octave',
		module: './sync-wasm-octave.mjs',
		exportName: 'syncWasmOctaveAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-prolog',
		module: './sync-wasm-prolog.mjs',
		exportName: 'syncWasmPrologAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-gleam',
		module: './sync-wasm-gleam.mjs',
		exportName: 'syncWasmGleamAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-perl',
		module: './sync-wasm-perl.mjs',
		exportName: 'syncWasmPerlAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-tcl',
		module: './sync-wasm-tcl.mjs',
		exportName: 'syncWasmTclAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-awk',
		module: './sync-wasm-awk.mjs',
		exportName: 'syncWasmAwkAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-pascal',
		module: './sync-wasm-pascal.mjs',
		exportName: 'syncWasmPascalAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-forth',
		module: './sync-wasm-forth.mjs',
		exportName: 'syncWasmForthAssets',
		sourceArg: 'sourceFile',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-j',
		module: './sync-wasm-j.mjs',
		exportName: 'syncWasmJAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-bqn',
		module: './sync-wasm-bqn.mjs',
		exportName: 'syncWasmBqnAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-janet',
		module: './sync-wasm-janet.mjs',
		exportName: 'syncWasmJanetAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-julia',
		module: './sync-wasm-julia.mjs',
		exportName: 'syncWasmJuliaAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-nim',
		module: './sync-wasm-nim.mjs',
		exportName: 'syncWasmNimAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-bash',
		module: './sync-wasm-bash.mjs',
		exportName: 'syncWasmBashAssets',
		sourceArg: 'sourceDir',
		targetArg: 'targetDir'
	},
	{
		name: 'wasm-of-js-of-ocaml',
		module: './sync-wasm-of-js-of-ocaml.mjs',
		exportName: 'syncWasmOfJsOfOcamlDist',
		sourceArg: 'sourceBrowserDistDir',
		targetArg: 'targetBrowserDistDir'
	}
];

export function runtimeListLine(runtime) {
	return `${runtime.name}${runtime.manual ? '\tmanual' : ''}`;
}

export function runtimesForAll({ includeManual = false } = {}) {
	return RUNTIMES.filter((candidate) => includeManual || !candidate.manual);
}

export function assertRuntimeSyncArgs(args) {
	if (args.length > 2) {
		throw new Error('runtime sync accepts at most sourceDir and targetDir arguments');
	}
	for (const arg of args) {
		if (arg.startsWith('-')) throw new Error(`Unknown option for runtime sync: ${arg}`);
	}
}

export function assertAllRuntimeSyncArgs(args) {
	if (args.length > 0) {
		throw new Error(`Unknown option for all runtime sync: ${args[0]}`);
	}
}

function usage() {
	console.log(`Usage:
  node scripts/sync-runtime.mjs list
  node scripts/sync-runtime.mjs all [--continue] [--include-manual]
  node scripts/sync-runtime.mjs <runtime> [sourceDir] [targetDir]

Runtime names:
  ${RUNTIMES.map((runtime) => `${runtime.name}${runtime.manual ? ' (manual)' : ''}`).join('\n  ')}
`);
}

function takeFlag(args, flag) {
	const index = args.indexOf(flag);
	if (index === -1) return false;
	args.splice(index, 1);
	return true;
}

async function syncRuntime(runtime, sourceDir, targetDir) {
	const moduleUrl = new URL(runtime.module, import.meta.url);
	const syncModule = await import(moduleUrl.href);
	const sync = syncModule[runtime.exportName];
	if (typeof sync !== 'function') {
		throw new Error(`${runtime.module} does not export ${runtime.exportName}.`);
	}
	const options = {};
	if (sourceDir) options[runtime.sourceArg] = path.resolve(sourceDir);
	if (targetDir) options[runtime.targetArg] = path.resolve(targetDir);
	const result = await sync(options);
	const source = result.sourceDir || result.sourceBrowserDistDir || sourceDir || '(default)';
	const target = result.targetDir || result.targetBrowserDistDir || targetDir || '(default)';
	console.log(`Synced ${runtime.name} from ${source} to ${target}`);
	return result;
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (!command || command === 'list') {
		for (const runtime of RUNTIMES) {
			console.log(runtimeListLine(runtime));
		}
		return;
	}
	if (command === 'all') {
		const keepGoing = takeFlag(args, '--continue');
		const includeManual = takeFlag(args, '--include-manual');
		assertAllRuntimeSyncArgs(args);
		let failed = false;
		for (const runtime of runtimesForAll({ includeManual })) {
			try {
				await syncRuntime(runtime);
			} catch (error) {
				failed = true;
				console.error(error instanceof Error ? error.message : error);
				if (!keepGoing) {
					process.exitCode = 1;
					return;
				}
			}
		}
		if (failed) process.exitCode = 1;
		return;
	}
	const runtime = RUNTIMES.find((candidate) => candidate.name === command);
	if (!runtime) {
		usage();
		process.exitCode = 1;
		return;
	}
	assertRuntimeSyncArgs(args);
	await syncRuntime(runtime, args[0], args[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
