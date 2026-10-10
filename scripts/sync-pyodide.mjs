import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'node_modules', 'pyodide');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'pyodide');

const PYODIDE_CORE_ASSETS = [
	'ffi.d.ts',
	'package.json',
	'pyodide-lock.json',
	'pyodide.asm.mjs',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.mjs',
	'python_stdlib.zip'
];

/** @param {Record<string, { name: string; version: string; file_name: string; sha256: string; depends: string[] }>} packages */
function collectWheelPackages(packages) {
	const pending = ['numpy', 'jedi'];
	const visited = new Set();
	const wheels = [];
	for (const name of pending) {
		if (visited.has(name)) continue;
		const entry = Object.hasOwn(packages, name) ? packages[name] : null;
		if (
			!entry ||
			entry.name !== name ||
			typeof entry.version !== 'string' ||
			!entry.version ||
			typeof entry.file_name !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(entry.file_name) ||
			typeof entry.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(entry.sha256) ||
			!Array.isArray(entry.depends) ||
			!entry.depends.every((dependency) => typeof dependency === 'string' && dependency)
		) {
			throw new Error(`Pyodide lock file has invalid wheel metadata for ${name}.`);
		}
		visited.add(name);
		wheels.push({
			name,
			version: entry.version,
			fileName: entry.file_name,
			sha256: entry.sha256
		});
		pending.push(...entry.depends);
	}
	return wheels;
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; wheelCacheDir?: string; fetchImpl?: typeof fetch }} [options]
 */
export async function syncPyodidePackage({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	wheelCacheDir = process.env.WASM_IDLE_PYODIDE_WHEEL_CACHE_DIR,
	fetchImpl = globalThis.fetch
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`Pyodide package directory was not found at ${sourceDir}.`);
	}

	for (const asset of PYODIDE_CORE_ASSETS) {
		const assetStats = await stat(path.join(sourceDir, asset)).catch(() => null);
		if (!assetStats?.isFile()) {
			throw new Error(
				`Required Pyodide asset was not found at ${path.join(sourceDir, asset)}.`
			);
		}
	}

	const packageJson = JSON.parse(await readFile(path.join(sourceDir, 'package.json'), 'utf8'));
	const lock = JSON.parse(await readFile(path.join(sourceDir, 'pyodide-lock.json'), 'utf8'));
	const { version } = await import(pathToFileURL(path.join(sourceDir, 'pyodide.mjs')).href);
	if (packageJson.name !== 'pyodide' || packageJson.version !== version) {
		throw new Error('Pyodide package and loader versions do not match.');
	}
	if (
		!lock.info ||
		lock.info.arch !== 'wasm32' ||
		typeof lock.info.abi_version !== 'string' ||
		!/^\d{4}_\d+$/u.test(lock.info.abi_version) ||
		typeof lock.info.python !== 'string' ||
		!/^3\.\d+\.\d+$/u.test(lock.info.python) ||
		typeof lock.info.platform !== 'string' ||
		!/^emscripten_\d+_\d+_\d+$/u.test(lock.info.platform) ||
		!lock.packages ||
		typeof lock.packages !== 'object' ||
		Array.isArray(lock.packages)
	) {
		throw new Error('Pyodide lock file has invalid Python or ABI metadata.');
	}

	const wheels = [];
	for (const wheel of collectWheelPackages(lock.packages)) {
		let contents;
		if (wheelCacheDir) {
			contents = await readFile(path.join(wheelCacheDir, wheel.fileName));
		} else {
			const url = `https://cdn.jsdelivr.net/pyodide/v${encodeURIComponent(version)}/full/${wheel.fileName}`;
			const response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
			if (!response.ok) {
				throw new Error(
					`Failed to download Pyodide wheel ${wheel.name}: HTTP ${response.status}.`
				);
			}
			contents = Buffer.from(await response.arrayBuffer());
		}
		if (createHash('sha256').update(contents).digest('hex') !== wheel.sha256) {
			throw new Error(`Pyodide wheel SHA256 mismatch for ${wheel.name} (${wheel.fileName}).`);
		}
		wheels.push({
			...wheel,
			contents,
			bytes: contents.length,
			source: wheelCacheDir ? 'cache' : 'official-cdn'
		});
	}

	// Validate every wheel, including transitive dependencies, before replacing the current runtime.
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });

	for (const asset of PYODIDE_CORE_ASSETS) {
		await cp(path.join(sourceDir, asset), path.join(targetDir, asset));
	}
	for (const wheel of wheels) {
		await writeFile(path.join(targetDir, wheel.fileName), wheel.contents);
	}

	return {
		sourceDir,
		targetDir,
		version,
		pythonVersion: lock.info.python,
		abiVersion: lock.info.abi_version,
		assets: [...PYODIDE_CORE_ASSETS, ...wheels.map((wheel) => wheel.fileName)],
		wheels: wheels.map(({ contents, ...wheel }) => wheel)
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg, wheelCacheDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncPyodidePackage({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR,
		wheelCacheDir: wheelCacheDirArg || process.env.WASM_IDLE_PYODIDE_WHEEL_CACHE_DIR
	});

	console.log(`Synced pyodide from ${sourceDir} to ${targetDir}`);
}
