import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');
const SHA256 = /^[0-9a-f]{64}$/u;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assertAsset(asset, label) {
	if (
		!asset ||
		typeof asset !== 'object' ||
		typeof asset.js !== 'string' ||
		typeof asset.wasm !== 'string' ||
		typeof asset.worker !== 'string' ||
		!SHA256.test(asset.jsSha256) ||
		!SHA256.test(asset.wasmSha256) ||
		!SHA256.test(asset.workerSha256)
	) {
		throw new Error(`wasm debug manifest has an invalid ${label} asset`);
	}
	return asset;
}

function resolveContained(root, relativePath) {
	if (path.isAbsolute(relativePath)) {
		throw new Error(`wasm debug asset path must be relative: ${relativePath}`);
	}
	const resolved = path.resolve(root, relativePath);
	const relative = path.relative(root, resolved);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`wasm debug asset escapes its release bundle: ${relativePath}`);
	}
	return resolved;
}

async function validateSourceBundle(sourceDir) {
	const manifestPath = path.join(sourceDir, 'runtime-manifest.v2.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (
		manifest?.manifestVersion !== 2 ||
		manifest?.debugger?.protocolVersion !== 1 ||
		manifest?.debugger?.transport !== 'shared-ring-v1'
	) {
		throw new Error('wasm debug runtime-manifest.v2.json has an invalid root contract');
	}
	const lldb = assertAsset(manifest.debugger.lldb, 'LLDB');
	const targetRuntime = assertAsset(manifest.debugger.targetRuntime, 'WAMR');
	if (
		targetRuntime.name !== 'wamr' ||
		typeof targetRuntime.revision !== 'string' ||
		typeof lldb.llvmRevision !== 'string'
	) {
		throw new Error('wasm debug runtime manifest is missing pinned LLDB/WAMR revisions');
	}

	const assets = [
		{ path: lldb.js, sha256: lldb.jsSha256 },
		{ path: lldb.wasm, sha256: lldb.wasmSha256 },
		{ path: lldb.worker, sha256: lldb.workerSha256 },
		{ path: targetRuntime.js, sha256: targetRuntime.jsSha256 },
		{ path: targetRuntime.wasm, sha256: targetRuntime.wasmSha256 },
		{ path: targetRuntime.worker, sha256: targetRuntime.workerSha256 }
	];
	for (const asset of assets) {
		const assetPath = resolveContained(sourceDir, asset.path);
		const metadata = await stat(assetPath).catch(() => null);
		if (!metadata?.isFile()) {
			throw new Error(`wasm debug runtime asset is missing: ${asset.path}`);
		}
		const actual = sha256(await readFile(assetPath));
		if (actual !== asset.sha256) {
			throw new Error(`wasm debug runtime asset ${asset.path} failed SHA-256 verification`);
		}
	}
	return { manifestPath, assets };
}

export async function syncWasmDebugDist({ sourceDir, staticDir = DEFAULT_STATIC_DIR } = {}) {
	if (!sourceDir) {
		throw new Error('wasm debug sync requires an explicit source directory.');
	}
	const resolvedSource = path.resolve(sourceDir);
	const resolvedStatic = path.resolve(staticDir);
	const { manifestPath, assets } = await validateSourceBundle(resolvedSource);
	await mkdir(resolvedStatic, { recursive: true });

	const suffix = `${process.pid}-${randomUUID()}`;
	const nextRoot = path.join(resolvedStatic, `.wasm-debug.next-${suffix}`);
	const previousRoot = path.join(resolvedStatic, `.wasm-debug.previous-${suffix}`);
	const next = path.join(nextRoot, 'wasm-debug');
	const current = path.join(resolvedStatic, 'wasm-debug');
	const previous = path.join(previousRoot, 'wasm-debug');
	let movedPrevious = false;
	try {
		await mkdir(next, { recursive: true });
		await cp(manifestPath, path.join(next, 'runtime-manifest.v2.json'));
		for (const asset of assets) {
			const destination = resolveContained(next, asset.path);
			await mkdir(path.dirname(destination), { recursive: true });
			await cp(resolveContained(resolvedSource, asset.path), destination);
		}
		if (await stat(current).catch(() => null)) {
			await mkdir(previousRoot, { recursive: true });
			await rename(current, previous);
			movedPrevious = true;
		}
		await rename(next, current);
		await rm(previousRoot, { recursive: true, force: true });
	} catch (error) {
		if (movedPrevious && !(await stat(current).catch(() => null))) {
			await rename(previous, current);
		}
		throw error;
	} finally {
		await rm(nextRoot, { recursive: true, force: true });
		await rm(previousRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [sourceDir, staticDir] = process.argv.slice(2);
	if (!sourceDir || process.argv.length > 4) {
		throw new Error('Usage: node scripts/sync-wasm-debug.mjs sourceDir [staticDir]');
	}
	await syncWasmDebugDist({ sourceDir, staticDir });
	console.log(`Synced wasm debug runtime from ${path.resolve(sourceDir)}`);
}
