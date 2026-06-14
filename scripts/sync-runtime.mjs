#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);

const RUNTIMES = [
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
		name: 'wasm-of-js-of-ocaml',
		module: './sync-wasm-of-js-of-ocaml.mjs',
		exportName: 'syncWasmOfJsOfOcamlDist',
		sourceArg: 'sourceBrowserDistDir',
		targetArg: 'targetBrowserDistDir'
	}
];

function usage() {
	console.log(`Usage:
  node scripts/sync-runtime.mjs list
  node scripts/sync-runtime.mjs all [--continue]
  node scripts/sync-runtime.mjs <runtime> [sourceDir] [targetDir]

Runtime names:
  ${RUNTIMES.map((runtime) => runtime.name).join('\n  ')}
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
		for (const runtime of RUNTIMES) console.log(runtime.name);
		return;
	}
	if (command === 'all') {
		const keepGoing = takeFlag(args, '--continue');
		let failed = false;
		for (const runtime of RUNTIMES) {
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
