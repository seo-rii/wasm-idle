import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, '..');
const wasmIdleRoot = path.resolve(runtimeRoot, '..', '..');
const workspaceRoot = path.resolve(wasmIdleRoot, '..');
const defaultSourceDir = path.resolve(workspaceRoot, 'ldc-wasm', 'dist', 'wasm-idle');
const defaultTargetDir = path.resolve(runtimeRoot, 'dist', 'runtime');

const USAGE = `Usage: node runtimes/wasm-d/scripts/prepare-runtime.mjs [--source DIR] [--out DIR]

Copies finalized ldc-wasm assets into wasm-idle's runtime asset directory.

Defaults:
  --source ${path.relative(wasmIdleRoot, defaultSourceDir)}
  --out    ${path.relative(wasmIdleRoot, defaultTargetDir)}
`;

function parseArgs(argv) {
	const options = {
		sourceDir: process.env.LDC_WASM_ASSET_DIR || defaultSourceDir,
		targetDir: process.env.WASM_IDLE_D_RUNTIME_DIR || defaultTargetDir
	};
	function readOptionValue(index, optionName) {
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`${optionName} requires a value`);
		}
		return value;
	}
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') {
			console.log(USAGE.trimEnd());
			process.exit(0);
		}
		if (arg === '--source') {
			options.sourceDir = readOptionValue(index, arg);
			index += 1;
			continue;
		}
		if (arg === '--out') {
			options.targetDir = readOptionValue(index, arg);
			index += 1;
			continue;
		}
		throw new Error(`unexpected argument: ${arg}`);
	}
	return {
		sourceDir: path.resolve(options.sourceDir),
		targetDir: path.resolve(options.targetDir)
	};
}

function assertAssetPath(assetPath) {
	if (typeof assetPath !== 'string' || assetPath.length === 0) {
		throw new Error(`invalid ldc-wasm asset path: ${String(assetPath)}`);
	}
	if (path.isAbsolute(assetPath)) {
		throw new Error(`ldc-wasm asset paths must be relative: ${assetPath}`);
	}
	const normalized = path.posix.normalize(assetPath);
	if (normalized === '..' || normalized.startsWith('../') || normalized !== assetPath) {
		throw new Error(`ldc-wasm asset path must stay inside the asset dir: ${assetPath}`);
	}
	return normalized;
}

function collectAssetPaths(value, found = new Set()) {
	if (!value || typeof value !== 'object') return found;
	if (Array.isArray(value)) {
		for (const item of value) collectAssetPaths(item, found);
		return found;
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === 'asset') found.add(assertAssetPath(child));
		collectAssetPaths(child, found);
	}
	return found;
}

async function sha256File(filePath) {
	const hash = crypto.createHash('sha256');
	hash.update(await fs.readFile(filePath));
	return hash.digest('hex');
}

const options = parseArgs(process.argv.slice(2));
const sourceManifestPath = path.join(options.sourceDir, 'runtime-manifest.v1.json');
const manifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'));
if (manifest.manifestVersion !== 1) {
	throw new Error(`unsupported ldc-wasm manifestVersion: ${manifest.manifestVersion}`);
}
if (manifest.name !== 'ldc-wasm') {
	throw new Error(`unexpected ldc-wasm manifest name: ${manifest.name}`);
}

const assets = [...collectAssetPaths(manifest)].sort();
if (assets.length === 0) {
	throw new Error(`ldc-wasm manifest does not reference any assets: ${sourceManifestPath}`);
}

await fs.rm(options.targetDir, { recursive: true, force: true });
await fs.mkdir(options.targetDir, { recursive: true });
await fs.copyFile(sourceManifestPath, path.join(options.targetDir, 'runtime-manifest.v1.json'));

const copiedAssets = [];
for (const asset of assets) {
	const sourcePath = path.join(options.sourceDir, asset);
	const targetPath = path.join(options.targetDir, asset);
	const stat = await fs.stat(sourcePath);
	if (!stat.isFile()) {
		throw new Error(`ldc-wasm manifest asset is not a file: ${asset}`);
	}
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.copyFile(sourcePath, targetPath);
	copiedAssets.push({
		asset,
		size: stat.size,
		sha256: await sha256File(sourcePath)
	});
}

await fs.writeFile(
	path.join(options.targetDir, 'runtime-build.json'),
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			source: path.relative(wasmIdleRoot, options.sourceDir),
			manifestSha256: await sha256File(sourceManifestPath),
			assets: copiedAssets
		},
		null,
		2
	)}\n`
);

console.log(`Prepared wasm-idle D runtime assets in ${options.targetDir}`);
