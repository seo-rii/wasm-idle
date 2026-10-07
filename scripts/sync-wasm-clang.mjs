import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { assertClangdStdinBridge } from './llvm-contracts/clangd-artifact-contract.mjs';
import {
	CLANGD_HEADER_ASSET,
	validateClangdHeaderMetadata,
	verifyClangdHeaderAsset
} from './llvm-contracts/clangd-header-asset-contract.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');

const DOCUMENTS = [
	{
		source: 'runtime-manifest.v1.json',
		target: 'clang/runtime-manifest.v1.json'
	},
	{
		source: 'runtime-build.json',
		target: 'clang/runtime-build.json'
	}
];
const ASSETS = [
	{
		asset: 'clang.zip',
		deliveryAsset: 'clang.wasm.gz',
		source: 'bin/clang.zip',
		target: 'clang/bin/clang.wasm.gz',
		entry: 'clang'
	},
	{
		asset: 'lld.zip',
		deliveryAsset: 'lld.wasm.gz',
		source: 'bin/lld.zip',
		target: 'clang/bin/lld.wasm.gz',
		entry: 'lld'
	},
	{
		asset: 'memfs.zip',
		deliveryAsset: 'memfs.wasm.gz',
		source: 'bin/memfs.zip',
		target: 'clang/bin/memfs.wasm.gz',
		entry: 'memfs'
	},
	{
		asset: 'sysroot.tar.zip',
		deliveryAsset: 'sysroot.tar.gz',
		source: 'bin/sysroot.tar.zip',
		target: 'clang/bin/sysroot.tar.gz',
		entry: 'sysroot.tar'
	},
	{
		asset: 'clangd/clangd.js',
		deliveryAsset: 'clangd/clangd.js',
		source: 'clangd/clangd.js',
		target: 'clangd/clangd.js'
	},
	{
		asset: 'clangd/clangd.wasm.gz',
		deliveryAsset: 'clangd/clangd.wasm.gz',
		source: 'clangd/clangd.wasm.gz',
		target: 'clangd/clangd.wasm.gz'
	}
];
const HEADER_ASSET = {
	asset: CLANGD_HEADER_ASSET,
	deliveryAsset: CLANGD_HEADER_ASSET,
	source: CLANGD_HEADER_ASSET,
	target: CLANGD_HEADER_ASSET,
	entry: undefined
};
const REQUIRED_FILES = [...DOCUMENTS, ...ASSETS];
const MEMFS_DOCUMENTS = [
	'memfs-build-receipt.json',
	'LICENSE.memfs-llvm.txt',
	'LICENSE.memfs-stb_sprintf.txt'
];

const MANIFEST_ASSETS = {
	source: {
		memfs: 'bin/memfs.zip',
		clang: 'bin/clang.zip',
		lld: 'bin/lld.zip',
		sysroot: 'bin/sysroot.tar.zip'
	},
	target: {
		memfs: 'bin/memfs.wasm.gz',
		clang: 'bin/clang.wasm.gz',
		lld: 'bin/lld.wasm.gz',
		sysroot: 'bin/sysroot.tar.gz'
	}
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} bundleDir
 * @param {'source' | 'target'} layout
 */
async function validateBundle(bundleDir, layout) {
	for (const file of REQUIRED_FILES) {
		const filePath = path.join(bundleDir, file[layout]);
		const fileStats = await stat(filePath).catch(() => null);
		if (!fileStats?.isFile()) {
			throw new Error(
				`wasm-clang runtime asset ${file.source} was not found in ${bundleDir}. Provide a complete source directory before syncing.`
			);
		}
	}

	const parsedDocuments = new Map();
	for (const document of DOCUMENTS) {
		try {
			parsedDocuments.set(
				document.source,
				JSON.parse(await readFile(path.join(bundleDir, document[layout]), 'utf8'))
			);
		} catch (error) {
			throw new Error(
				`wasm-clang ${document.source} is not valid JSON: ${error instanceof Error ? error.message : error}`
			);
		}
	}

	const manifest = parsedDocuments.get('runtime-manifest.v1.json');
	if (
		!isObject(manifest) ||
		manifest.manifestVersion !== 1 ||
		typeof manifest.version !== 'string' ||
		manifest.version.length === 0 ||
		manifest.defaultTarget !== 'wasm32-wasi'
	) {
		throw new Error('wasm-clang runtime-manifest.v1.json has an invalid root shape');
	}

	const compiler = manifest.compiler;
	const clangd = manifest.clangd;
	const targets = manifest.targets;
	if (!isObject(compiler) || !isObject(clangd) || !isObject(targets)) {
		throw new Error(
			'wasm-clang runtime-manifest.v1.json is missing compiler, clangd, or target metadata'
		);
	}

	const memfs = compiler.memfs;
	const clang = compiler.clang;
	const lld = compiler.lld;
	const sysroot = compiler.sysroot;
	const wasiTarget = targets['wasm32-wasi'];
	if (
		!isObject(memfs) ||
		!isObject(clang) ||
		!isObject(lld) ||
		!isObject(sysroot) ||
		!isObject(wasiTarget) ||
		!isObject(wasiTarget.execution) ||
		memfs.argv0 !== 'memfs' ||
		clang.argv0 !== 'clang' ||
		lld.argv0 !== 'wasm-ld' ||
		wasiTarget.artifactFormat !== 'wasi-core-wasm' ||
		wasiTarget.execution.kind !== 'wasi-preview1' ||
		(compiler.resourceDir !== undefined &&
			(typeof compiler.resourceDir !== 'string' || compiler.resourceDir.length === 0)) ||
		(compiler.compilerRuntimeLibDir !== undefined &&
			(typeof compiler.compilerRuntimeLibDir !== 'string' ||
				compiler.compilerRuntimeLibDir.length === 0))
	) {
		throw new Error('wasm-clang runtime-manifest.v1.json contains invalid runtime metadata');
	}

	const expectedManifestAssets = MANIFEST_ASSETS[layout];
	if (
		memfs.asset !== expectedManifestAssets.memfs ||
		clang.asset !== expectedManifestAssets.clang ||
		lld.asset !== expectedManifestAssets.lld ||
		sysroot.asset !== expectedManifestAssets.sysroot ||
		clangd.js !== 'clangd/clangd.js' ||
		clangd.wasm !== 'clangd/clangd.wasm.gz'
	) {
		throw new Error(
			'wasm-clang runtime-manifest.v1.json does not reference the complete Clang runtime asset set'
		);
	}

	const buildInfo = parsedDocuments.get('runtime-build.json');
	if (
		!isObject(buildInfo) ||
		!isObject(buildInfo.toolchain) ||
		!Array.isArray(buildInfo.assets)
	) {
		throw new Error('wasm-clang runtime-build.json is missing toolchain or asset metadata');
	}
	if (
		typeof buildInfo.toolchain.version !== 'string' ||
		buildInfo.toolchain.version.length === 0
	) {
		throw new Error('wasm-clang runtime-build.json has an invalid toolchain version');
	}
	if (manifest.version !== buildInfo.toolchain.version) {
		throw new Error(
			`wasm-clang runtime manifest version ${manifest.version} does not match runtime-build.json version ${buildInfo.toolchain.version}`
		);
	}
	if (
		!isObject(buildInfo.toolchain.clangd) ||
		buildInfo.toolchain.clangd.stdinBridge !== 'emscripten-asyncify' ||
		typeof buildInfo.toolchain.clangd.patch !== 'string' ||
		buildInfo.toolchain.clangd.patch.length === 0 ||
		typeof buildInfo.toolchain.clangd.patchSha256 !== 'string' ||
		!/^[0-9a-f]{64}$/.test(buildInfo.toolchain.clangd.patchSha256)
	) {
		throw new Error('wasm-clang runtime-build.json is missing the clangd stdin bridge receipt');
	}
	const bundleAssets = [...ASSETS];
	const headerDescriptor = buildInfo.toolchain.clangd.headers;
	if (headerDescriptor !== undefined || clangd.headers !== undefined) {
		const headers = validateClangdHeaderMetadata(headerDescriptor);
		const manifestHeaders = validateClangdHeaderMetadata(clangd.headers);
		if (
			JSON.stringify(headers) !== JSON.stringify(manifestHeaders) ||
			headers.resourceDir !== compiler.resourceDir ||
			headers.resourceDir !== buildInfo.toolchain.resourceDir ||
			headers.targetTriple !== manifest.defaultTarget
		)
			throw new Error('wasm-clang header manifest does not match its toolchain metadata');
		bundleAssets.push(HEADER_ASSET);
		const fileStats = await stat(path.join(bundleDir, HEADER_ASSET[layout])).catch(() => null);
		if (!fileStats?.isFile())
			throw new Error(
				`wasm-clang runtime asset ${CLANGD_HEADER_ASSET} was not found in ${bundleDir}`
			);
	}

	const buildAssets = new Map();
	for (const entry of buildInfo.assets) {
		if (
			!isObject(entry) ||
			typeof entry.asset !== 'string' ||
			buildAssets.has(entry.asset) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0 ||
			typeof entry.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(entry.sha256)
		) {
			throw new Error(
				'wasm-clang runtime-build.json contains invalid or duplicate asset metadata'
			);
		}
		buildAssets.set(entry.asset, entry);
	}

	const expectedAssetNames = bundleAssets.map((asset) =>
		layout === 'source' ? asset.asset : asset.deliveryAsset
	);
	if (
		buildAssets.size !== bundleAssets.length ||
		expectedAssetNames.some((asset) => !buildAssets.has(asset))
	) {
		throw new Error(
			'wasm-clang runtime-build.json does not describe the complete runtime asset set'
		);
	}

	const toolchainAssets = buildInfo.toolchain.assets;
	if (toolchainAssets !== undefined) {
		if (
			!isObject(toolchainAssets) ||
			Object.keys(toolchainAssets).length !== bundleAssets.length ||
			expectedAssetNames.some(
				(asset) =>
					typeof toolchainAssets[asset] !== 'string' ||
					!/^[0-9a-f]{64}$/.test(toolchainAssets[asset]) ||
					toolchainAssets[asset] !== buildAssets.get(asset).sha256
			)
		) {
			throw new Error(
				'wasm-clang runtime-build.json toolchain assets do not match its release asset metadata'
			);
		}
	}

	for (const asset of bundleAssets) {
		const filePath = path.join(bundleDir, asset[layout]);
		const fileStats = await stat(filePath);
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(filePath)) hash.update(chunk);
		const metadata = buildAssets.get(layout === 'source' ? asset.asset : asset.deliveryAsset);
		if (metadata.size !== fileStats.size || metadata.sha256 !== hash.digest('hex')) {
			throw new Error(
				`wasm-clang runtime asset ${asset.source} does not match runtime-build.json`
			);
		}
	}
	if (headerDescriptor !== undefined)
		verifyClangdHeaderAsset(
			await readFile(path.join(bundleDir, CLANGD_HEADER_ASSET)),
			headerDescriptor
		);
	const memfsMetadata = buildInfo.toolchain.memfs;
	if (isObject(memfsMetadata) && memfsMetadata.files !== undefined) {
		const files = memfsMetadata.files;
		const receipt = memfsMetadata.buildReceipt;
		if (
			!isObject(files) ||
			Object.keys(files).length !== MEMFS_DOCUMENTS.length ||
			!isObject(receipt) ||
			receipt.format !== 'wasm-llvm-memfs-build-v1'
		)
			throw new Error('Invalid MemFS sidecar metadata');
		const root = layout === 'source' ? bundleDir : path.join(bundleDir, 'clang');
		for (const name of MEMFS_DOCUMENTS) {
			const pin = files[name];
			if (
				!isObject(pin) ||
				!Number.isSafeInteger(pin.bytes) ||
				pin.bytes <= 0 ||
				typeof pin.sha256 !== 'string' ||
				!/^[0-9a-f]{64}$/.test(pin.sha256)
			) {
				throw new Error(`Invalid MemFS sidecar receipt: ${name}`);
			}
			const bytes = await readFile(path.join(root, name));
			if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) {
				throw new Error(`MemFS sidecar does not match its receipt: ${name}`);
			}
			if (
				name === 'memfs-build-receipt.json' &&
				JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(receipt)
			) {
				throw new Error('MemFS build receipt does not match toolchain metadata');
			}
		}
		const delivered = await readFile(
			path.join(root, 'bin', layout === 'source' ? 'memfs.zip' : 'memfs.wasm.gz')
		);
		const wasm = layout === 'source' ? unzipSync(delivered).memfs : gunzipSync(delivered);
		const pin = receipt.outputs?.['memfs.wasm'];
		if (
			!wasm ||
			!isObject(pin) ||
			wasm.length !== pin.bytes ||
			createHash('sha256').update(wasm).digest('hex') !== pin.sha256
		) {
			throw new Error('MemFS payload does not match its source build receipt');
		}
	}

	const clangdJs = await readFile(path.join(bundleDir, 'clangd', 'clangd.js'), 'utf8');
	const clangdWasm = gunzipSync(await readFile(path.join(bundleDir, 'clangd', 'clangd.wasm.gz')));
	await assertClangdStdinBridge(clangdJs, clangdWasm);
}

/** @param {Buffer} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} filePath @param {unknown} value */
async function writeJson(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {string} sourceDir @param {string} targetRoot */
async function writeDeliveryBundle(sourceDir, targetRoot) {
	const sourceManifest = JSON.parse(
		await readFile(path.join(sourceDir, 'runtime-manifest.v1.json'), 'utf8')
	);
	const bundleAssets = [...ASSETS, ...(sourceManifest.clangd.headers ? [HEADER_ASSET] : [])];
	for (const asset of bundleAssets) {
		const sourcePath = path.join(sourceDir, asset.source);
		const targetPath = path.join(targetRoot, asset.target);
		await mkdir(path.dirname(targetPath), { recursive: true });
		if (!asset.entry) {
			await cp(sourcePath, targetPath);
			continue;
		}

		let entries;
		try {
			entries = unzipSync(await readFile(sourcePath));
		} catch (error) {
			throw new Error(
				`wasm-clang runtime asset ${asset.source} could not be repackaged: ${error instanceof Error ? error.message : error}`
			);
		}
		const files = Object.entries(entries).filter(([entryName]) => !entryName.endsWith('/'));
		if (files.length !== 1 || files[0][0] !== asset.entry) {
			throw new Error(
				`wasm-clang runtime asset ${asset.source} must contain only ${asset.entry}`
			);
		}
		await writeFile(targetPath, gzipSync(files[0][1], { level: 9 }));
	}

	const deliveryManifest = JSON.parse(JSON.stringify(sourceManifest));
	deliveryManifest.compiler.memfs.asset = MANIFEST_ASSETS.target.memfs;
	deliveryManifest.compiler.clang.asset = MANIFEST_ASSETS.target.clang;
	deliveryManifest.compiler.lld.asset = MANIFEST_ASSETS.target.lld;
	deliveryManifest.compiler.sysroot.asset = MANIFEST_ASSETS.target.sysroot;

	const sourceBuildInfo = JSON.parse(
		await readFile(path.join(sourceDir, 'runtime-build.json'), 'utf8')
	);
	if (sourceBuildInfo.toolchain.memfs?.files) {
		for (const name of MEMFS_DOCUMENTS) {
			await cp(path.join(sourceDir, name), path.join(targetRoot, 'clang', name));
		}
	}
	const deliveryAssets = [];
	for (const asset of bundleAssets) {
		const bytes = await readFile(path.join(targetRoot, asset.target));
		deliveryAssets.push({
			asset: asset.deliveryAsset,
			size: bytes.byteLength,
			sha256: sha256(bytes)
		});
	}
	const deliveryBuildInfo = {
		...sourceBuildInfo,
		toolchain: {
			...sourceBuildInfo.toolchain,
			assets: Object.fromEntries(deliveryAssets.map((asset) => [asset.asset, asset.sha256]))
		},
		assets: deliveryAssets,
		delivery: {
			format: 'wasm-idle-clang-native-gzip-v1',
			sourceAssets: sourceBuildInfo.assets
		}
	};

	await writeJson(path.join(targetRoot, 'clang/runtime-manifest.v1.json'), deliveryManifest);
	await writeJson(path.join(targetRoot, 'clang/runtime-build.json'), deliveryBuildInfo);
}

/** @param {{ sourceDir?: string; staticDir?: string }} [options] */
export async function syncWasmClangDist({ sourceDir, staticDir = DEFAULT_STATIC_DIR } = {}) {
	if (!sourceDir) {
		throw new Error('wasm-clang sync requires an explicit source directory.');
	}
	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedStaticDir = path.resolve(staticDir);
	await validateBundle(resolvedSourceDir, 'source');

	await mkdir(resolvedStaticDir, { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const nextRoot = path.join(resolvedStaticDir, `.wasm-clang.next-${suffix}`);
	const previousRoot = path.join(resolvedStaticDir, `.wasm-clang.previous-${suffix}`);
	const installations = [
		{
			current: path.join(resolvedStaticDir, 'clang'),
			next: path.join(nextRoot, 'clang'),
			previous: path.join(previousRoot, 'clang'),
			hadPrevious: false,
			installed: false
		},
		{
			current: path.join(resolvedStaticDir, 'clangd'),
			next: path.join(nextRoot, 'clangd'),
			previous: path.join(previousRoot, 'clangd'),
			hadPrevious: false,
			installed: false
		}
	];
	let keepPreviousRoot = false;

	try {
		await writeDeliveryBundle(resolvedSourceDir, nextRoot);
		await validateBundle(nextRoot, 'target');

		await mkdir(previousRoot, { recursive: true });
		for (const installation of installations) {
			const currentStats = await lstat(installation.current).catch(() => null);
			if (currentStats) {
				await rename(installation.current, installation.previous);
				installation.hadPrevious = true;
			}
		}
		for (const installation of installations) {
			await rename(installation.next, installation.current);
			installation.installed = true;
		}
	} catch (error) {
		const rollbackErrors = [];
		for (const installation of [...installations].reverse()) {
			if (!installation.installed) continue;
			try {
				await rm(installation.current, { recursive: true, force: true });
				installation.installed = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		for (const installation of installations) {
			if (!installation.hadPrevious) continue;
			try {
				await rename(installation.previous, installation.current);
				installation.hadPrevious = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}

		if (rollbackErrors.length > 0) {
			keepPreviousRoot = true;
			throw new AggregateError(
				[error, ...rollbackErrors],
				'wasm-clang sync failed and could not restore all existing targets'
			);
		}
		throw error;
	} finally {
		await rm(nextRoot, { recursive: true, force: true }).catch(() => {});
		if (!keepPreviousRoot) {
			await rm(previousRoot, { recursive: true, force: true }).catch(() => {});
		}
	}

	return { sourceDir: resolvedSourceDir, staticDir: resolvedStaticDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	let args = process.argv.slice(2);
	if (args[0] === '--') args = args.slice(1);
	if (args.length > 2) {
		throw new Error('wasm-clang sync accepts at most sourceDir and staticDir arguments');
	}
	const [sourceDirArg, staticDirArg] = args;
	const result = await syncWasmClangDist({
		sourceDir: sourceDirArg,
		staticDir: staticDirArg || DEFAULT_STATIC_DIR
	});
	console.log(`Synced Clang assets from ${result.sourceDir} to ${result.staticDir}`);
}
