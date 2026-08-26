import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');
export const DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH = path.join(
	REPO_ROOT,
	'src/lib/playground/wasmDebugVersion.ts'
);
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
	const manifestBytes = await readFile(manifestPath);
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
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
	return { manifestPath, manifestBytes, assets };
}

function renderVersionModule(manifestBytes) {
	return `export const WASM_DEBUG_RUNTIME_PROFILE = Object.freeze({
\tmanifestReceipt: Object.freeze({
\t\tbytes: ${manifestBytes.byteLength},
\t\tsha256: '${sha256(manifestBytes)}'
\t})
});
`;
}

export async function verifySyncedWasmDebugDist({
	staticDir = DEFAULT_STATIC_DIR,
	versionModulePath = DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH
} = {}) {
	const installedRoot = path.join(path.resolve(staticDir), 'wasm-debug');
	const { manifestBytes } = await validateSourceBundle(installedRoot);
	const actualVersionModule = await readFile(path.resolve(versionModulePath), 'utf8');
	if (actualVersionModule !== renderVersionModule(manifestBytes)) {
		throw new Error('wasm debug runtime receipt does not match the installed manifest');
	}
}

export async function syncWasmDebugDist({
	sourceDir,
	staticDir = DEFAULT_STATIC_DIR,
	versionModulePath = DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH,
	testOnlyAfterRuntimePublish
} = {}) {
	if (!sourceDir) {
		throw new Error('wasm debug sync requires an explicit source directory.');
	}
	const resolvedSource = path.resolve(sourceDir);
	const resolvedStatic = path.resolve(staticDir);
	const resolvedVersionModule = path.resolve(versionModulePath);
	const { manifestPath, manifestBytes, assets } = await validateSourceBundle(resolvedSource);
	await mkdir(resolvedStatic, { recursive: true });
	await mkdir(path.dirname(resolvedVersionModule), { recursive: true });

	const suffix = `${process.pid}-${randomUUID()}`;
	const nextRoot = path.join(resolvedStatic, `.wasm-debug.next-${suffix}`);
	const previousRoot = path.join(resolvedStatic, `.wasm-debug.previous-${suffix}`);
	const next = path.join(nextRoot, 'wasm-debug');
	const current = path.join(resolvedStatic, 'wasm-debug');
	const previous = path.join(previousRoot, 'wasm-debug');
	const versionName = path.basename(resolvedVersionModule);
	const versionDir = path.dirname(resolvedVersionModule);
	const nextVersionModule = path.join(versionDir, `.${versionName}.next-${suffix}`);
	const previousVersionModule = path.join(versionDir, `.${versionName}.previous-${suffix}`);
	let movedPrevious = false;
	let movedPreviousVersion = false;
	let installedNext = false;
	let installedNextVersion = false;
	let preserveRecoveryFiles = false;
	try {
		await mkdir(next, { recursive: true });
		await cp(manifestPath, path.join(next, 'runtime-manifest.v2.json'));
		for (const asset of assets) {
			const destination = resolveContained(next, asset.path);
			await mkdir(path.dirname(destination), { recursive: true });
			await cp(resolveContained(resolvedSource, asset.path), destination);
		}
		await writeFile(nextVersionModule, renderVersionModule(manifestBytes));
		await verifySyncedWasmDebugDist({
			staticDir: nextRoot,
			versionModulePath: nextVersionModule
		});
		if (await stat(current).catch(() => null)) {
			await mkdir(previousRoot, { recursive: true });
			await rename(current, previous);
			movedPrevious = true;
		}
		const versionMetadata = await stat(resolvedVersionModule).catch(() => null);
		if (versionMetadata) {
			if (!versionMetadata.isFile()) {
				throw new Error('wasm debug version module path must be a file');
			}
			await rename(resolvedVersionModule, previousVersionModule);
			movedPreviousVersion = true;
		}
		await rename(next, current);
		installedNext = true;
		await testOnlyAfterRuntimePublish?.();
		await rename(nextVersionModule, resolvedVersionModule);
		installedNextVersion = true;
		await verifySyncedWasmDebugDist({
			staticDir: resolvedStatic,
			versionModulePath: resolvedVersionModule
		});
	} catch (error) {
		const rollbackErrors = [];
		for (const operation of [
			async () => {
				if (installedNextVersion) {
					await rm(resolvedVersionModule, { force: true });
				}
			},
			async () => {
				if (installedNext) {
					await rm(current, { recursive: true, force: true });
				}
			},
			async () => {
				if (movedPrevious) {
					await rename(previous, current);
				}
			},
			async () => {
				if (movedPreviousVersion) {
					await rename(previousVersionModule, resolvedVersionModule);
				}
			}
		]) {
			try {
				await operation();
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0) {
			preserveRecoveryFiles = true;
			throw new AggregateError(
				[error, ...rollbackErrors],
				'wasm debug publication failed and could not be rolled back completely'
			);
		}
		throw error;
	} finally {
		await rm(nextRoot, { recursive: true, force: true });
		await rm(nextVersionModule, { force: true });
		if (!preserveRecoveryFiles) {
			await rm(previousRoot, { recursive: true, force: true });
			await rm(previousVersionModule, { force: true });
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [sourceDir, staticDir, versionModulePath] = process.argv.slice(2);
	if (!sourceDir || process.argv.length > 5) {
		throw new Error(
			'Usage: node scripts/sync-wasm-debug.mjs sourceDir [staticDir] [versionModulePath]'
		);
	}
	await syncWasmDebugDist({ sourceDir, staticDir, versionModulePath });
	console.log(`Synced wasm debug runtime from ${path.resolve(sourceDir)}`);
}
