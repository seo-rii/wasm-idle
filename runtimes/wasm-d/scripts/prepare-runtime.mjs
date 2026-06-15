import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, '..');
const wasmIdleRoot = path.resolve(runtimeRoot, '..', '..');
const workspaceRoot = path.resolve(wasmIdleRoot, '..');
const defaultSourceDir = path.resolve(workspaceRoot, 'ldc-wasm', 'dist', 'wasm-idle');
const defaultTargetDir = path.resolve(runtimeRoot, 'dist', 'runtime');

const TOOLCHAIN_ASSET = 'toolchain/toolchain.tar';

const USAGE = `Usage: node runtimes/wasm-d/scripts/prepare-runtime.mjs [--source DIR] [--out DIR]

Creates browser-ready wasm-idle D runtime assets from finalized ldc-wasm assets.

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

async function run(command, args, options = {}) {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			...options
		});
		const stdout = [];
		const stderr = [];
		child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
		child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
		child.on('error', reject);
		child.on('close', (code, signal) => {
			const output = Buffer.concat(stdout).toString('utf8');
			const error = Buffer.concat(stderr).toString('utf8');
			if (code === 0) {
				resolve({ stdout: output, stderr: error });
				return;
			}
			reject(
				new Error(
					`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with code ${code}`}${error ? `\n${error}` : ''}`
				)
			);
		});
	});
}

async function extractTarZst(archivePath, targetDir) {
	await fs.mkdir(targetDir, { recursive: true });
	await run('tar', ['--zstd', '-xf', archivePath, '-C', targetDir]);
}

async function createUncompressedTar(sourceDir, archivePath) {
	await fs.mkdir(path.dirname(archivePath), { recursive: true });
	await run('tar', ['-cf', archivePath, '-C', sourceDir, '.']);
}

const options = parseArgs(process.argv.slice(2));
const sourceManifestPath = path.join(options.sourceDir, 'runtime-manifest.v1.json');
const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'));
if (sourceManifest.manifestVersion !== 1) {
	throw new Error(`unsupported ldc-wasm manifestVersion: ${sourceManifest.manifestVersion}`);
}
if (sourceManifest.name !== 'ldc-wasm') {
	throw new Error(`unexpected ldc-wasm manifest name: ${sourceManifest.name}`);
}

const sourceAssets = [...collectAssetPaths(sourceManifest)].sort();
if (sourceAssets.length === 0) {
	throw new Error(`ldc-wasm manifest does not reference any assets: ${sourceManifestPath}`);
}

const requiredAssets = {
	ldc2: assertAssetPath(sourceManifest.compiler?.ldc2?.asset),
	config: assertAssetPath(sourceManifest.compiler?.config?.asset),
	imports: assertAssetPath(sourceManifest.compiler?.imports?.asset),
	runtimeLibraries: assertAssetPath(sourceManifest.compiler?.runtimeLibraries?.asset),
	lldJs: assertAssetPath(sourceManifest.compiler?.linker?.js?.asset),
	lldWasm: assertAssetPath(sourceManifest.compiler?.linker?.wasm?.asset),
	lldData: assertAssetPath(sourceManifest.compiler?.linker?.data?.asset)
};

await fs.rm(options.targetDir, { recursive: true, force: true });
await fs.mkdir(options.targetDir, { recursive: true });

for (const asset of Object.values(requiredAssets)) {
	const stat = await fs.stat(path.join(options.sourceDir, asset)).catch(() => null);
	if (!stat?.isFile()) throw new Error(`ldc-wasm manifest asset is not a file: ${asset}`);
}

const targetLdc2Asset = 'bin/ldc2.wasm';
await fs.mkdir(path.join(options.targetDir, 'bin'), { recursive: true });
await fs.copyFile(
	path.join(options.sourceDir, requiredAssets.ldc2),
	path.join(options.targetDir, targetLdc2Asset)
);
const linkerAssets = {
	js: 'bin/lld.js',
	wasm: 'bin/lld.wasm',
	data: 'bin/lld.data'
};
await fs.copyFile(path.join(options.sourceDir, requiredAssets.lldJs), path.join(options.targetDir, linkerAssets.js));
await fs.copyFile(
	path.join(options.sourceDir, requiredAssets.lldWasm),
	path.join(options.targetDir, linkerAssets.wasm)
);
await fs.copyFile(
	path.join(options.sourceDir, requiredAssets.lldData),
	path.join(options.targetDir, linkerAssets.data)
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-idle-d-runtime-'));
try {
	const toolchainRoot = path.join(tempRoot, 'toolchain');
	await fs.mkdir(path.join(toolchainRoot, 'etc'), { recursive: true });
	await fs.mkdir(path.join(toolchainRoot, 'imports'), { recursive: true });
	await extractTarZst(path.join(options.sourceDir, requiredAssets.config), path.join(toolchainRoot, 'etc'));
	await extractTarZst(path.join(options.sourceDir, requiredAssets.imports), path.join(toolchainRoot, 'imports'));
	await extractTarZst(path.join(options.sourceDir, requiredAssets.runtimeLibraries), toolchainRoot);
	await createUncompressedTar(toolchainRoot, path.join(options.targetDir, TOOLCHAIN_ASSET));
} finally {
	await fs.rm(tempRoot, { recursive: true, force: true });
}

const targetManifest = {
	manifestVersion: 1,
	name: 'wasm-d',
	version: sourceManifest.version,
	defaultTarget: 'wasm32-wasi',
	compiler: {
		ldc2: {
			asset: targetLdc2Asset,
			argv0: sourceManifest.compiler.ldc2.argv0 || 'ldc2'
		},
		toolchain: {
			asset: TOOLCHAIN_ASSET
		},
		linker: {
			kind: 'emscripten-lld',
			argv0: sourceManifest.compiler.linker.argv0 || 'wasm-ld',
			js: {
				asset: linkerAssets.js
			},
			wasm: {
				asset: linkerAssets.wasm
			},
			data: {
				asset: linkerAssets.data
			}
		}
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: {
				kind: 'wasi-preview1'
			}
		}
	}
};

await fs.writeFile(
	path.join(options.targetDir, 'runtime-manifest.v1.json'),
	`${JSON.stringify(targetManifest, null, 2)}\n`,
	'utf8'
);

const targetAssets = [targetLdc2Asset, linkerAssets.js, linkerAssets.wasm, linkerAssets.data, TOOLCHAIN_ASSET];
const preparedAssets = [];
for (const asset of targetAssets) {
	const filePath = path.join(options.targetDir, asset);
	const stat = await fs.stat(filePath);
	preparedAssets.push({
		asset,
		size: stat.size,
		sha256: await sha256File(filePath)
	});
}

await fs.writeFile(
	path.join(options.targetDir, 'runtime-build.json'),
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			source: path.relative(wasmIdleRoot, options.sourceDir),
			manifestSha256: await sha256File(sourceManifestPath),
			sourceAssets,
			assets: preparedAssets
		},
		null,
		2
	)}\n`
);

console.log(`Prepared wasm-idle D runtime assets in ${options.targetDir}`);
