import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));

export function createBuildIdentity() {
	let commit = 'unknown';
	try {
		commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	} catch {
		/* Archives may not contain .git. */
	}
	const runtimeAssets = {};
	for (const name of [
		'worker.js',
		'compressed-runtime-assets.v1.json',
		'wasm-dotnet/runtime/manifest.json',
		'wasm-dotnet/runtime-loader.js',
		'wasm-dotnet/compiler.js'
	]) {
		const filename = path.join(root, 'static', name);
		if (existsSync(filename))
			runtimeAssets[name] = createHash('sha256').update(readFileSync(filename)).digest('hex');
	}
	const layerManifestPath = path.join(root, 'static/layered-runtime-assets.v1.json');
	if (existsSync(layerManifestPath)) {
		const manifest = JSON.parse(readFileSync(layerManifestPath, 'utf8'));
		const layers = new Map();
		for (const [name, entry] of Object.entries(manifest.assets ?? {})) {
			if (
				!/^wasm-dotnet\/runtime\/(csharp|fsharp|vbnet)\/(blazor\.boot\.json|dotnet\.native\.js)$/.test(
					name
				)
			)
				continue;
			if (!layers.has(entry.layer))
				layers.set(
					entry.layer,
					gunzipSync(readFileSync(path.join(root, 'static', entry.layer)))
				);
			const bytes = layers
				.get(entry.layer)
				.subarray(entry.offset, entry.offset + entry.length);
			runtimeAssets[name] = createHash('sha256').update(bytes).digest('hex');
		}
	}
	return { commit, builtAt: new Date().toISOString(), runtimeAssets };
}
