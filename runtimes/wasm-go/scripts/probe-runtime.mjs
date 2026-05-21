import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');
const distRoot = path.join(projectRoot, 'dist');
const runtimeDir = path.join(distRoot, 'runtime');
const packEntriesCache = new Map();

async function loadRuntimeManifest() {
	return JSON.parse(
		await readFile(path.join(runtimeDir, 'runtime-manifest.v1.json'), 'utf8')
	);
}

async function loadPackEntries(packAsset, indexAsset) {
	const cacheKey = `${packAsset}:${indexAsset}`;
	const cached = packEntriesCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const loaded = (async () => {
		const packBytes = gunzipSync(await readFile(path.join(runtimeDir, packAsset)));
		const index = JSON.parse(
			gunzipSync(await readFile(path.join(runtimeDir, indexAsset))).toString('utf8')
		);
		return index.entries.map((entry) => ({
			runtimePath: entry.runtimePath,
			bytes: packBytes.subarray(entry.offset, entry.offset + entry.length)
		}));
	})();
	packEntriesCache.set(cacheKey, loaded);
	return await loaded;
}

async function main() {
	const manifest = await loadRuntimeManifest();
	const [{ compileGo, executeBrowserGoArtifact }] = await Promise.all([
		import(pathToFileURL(path.join(distRoot, 'index.js')).toString())
	]);
	const packagedTargets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'].filter(
		(target) => manifest.targets[target]
	);
	if (packagedTargets.length === 0) {
		throw new Error('runtime manifest is missing all packaged targets');
	}
	for (const targetKey of packagedTargets) {
		const target = manifest.targets[targetKey];
		if (!target?.sysrootPack) {
			throw new Error(`runtime manifest target ${targetKey} is missing sysrootPack`);
		}
		await loadPackEntries(target.sysrootPack.asset, target.sysrootPack.index);
		const compileResult = await compileGo({
			target: targetKey,
			code: `package main

import "fmt"

func main() {
	fmt.Println("probe-ok")
}
`,
			log: true
		});
		if (!compileResult.success || !compileResult.artifact) {
			throw new Error(
				`compile probe failed for ${targetKey}: ${compileResult.stderr || 'unknown error'}`
			);
		}
		const runtimeResult = await executeBrowserGoArtifact(compileResult.artifact);
		if (runtimeResult.exitCode !== 0) {
			throw new Error(`runtime probe exited with ${runtimeResult.exitCode} for ${targetKey}`);
		}
		if (runtimeResult.stdout !== 'probe-ok\n') {
			throw new Error(
				`runtime probe stdout mismatch for ${targetKey}: ${JSON.stringify(runtimeResult.stdout)}`
			);
		}
		console.log(`${targetKey}.compile.success=true`);
		console.log(`${targetKey}.artifact.format=${compileResult.artifact.format}`);
		console.log(`${targetKey}.runtime.exitCode=${runtimeResult.exitCode}`);
		console.log(`${targetKey}.runtime.stdout=${JSON.stringify(runtimeResult.stdout)}`);
	}
}

await main();
