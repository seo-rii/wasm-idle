import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';
import { loadBundledProfile } from './verify-pinned-runtime-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const compressedIndex = 'compressed-runtime-assets.v1.json';
const layeredIndex = 'layered-runtime-assets.v1.json';
const compactIndex = 'compact-runtime-aliases.v1.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

function relative(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.startsWith('/') ||
		/[\\%\0?#]/u.test(value) ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error(`Unsafe page asset path: ${value}`);
	return value;
}

function receipt(value, label) {
	if (
		!value ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes < 0 ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	)
		throw new Error(`Invalid pinned page asset receipt: ${label}`);
	return value;
}

function equalReceipt(actual, expected, label) {
	receipt(expected, label);
	if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
		throw new Error(`Page asset size/SHA-256 mismatch: ${label}`);
}

/** Pin separately produced LSP bundles even when an older core lock omits their directories. */
export async function loadPinnedPageLspAssets() {
	const assets = {};
	const add = (directory, entries) => {
		for (const [name, expected] of Object.entries(entries)) {
			const assetPath = relative(`${directory}/${name}`);
			receipt(expected, assetPath);
			assets[assetPath] = { bytes: expected.bytes, sha256: expected.sha256 };
		}
	};
	for (const [directory, lockFile] of [
		['c3', 'c3-lsp.lock.json'],
		['v', 'v-lsp.lock.json'],
		['nim', 'nim-lsp-assets.lock.json'],
		['grain', 'grain-lsp-assets.lock.json'],
		['fennel', 'fennel-lsp-assets.lock.json'],
		['rescript', 'rescript-lsp-assets.lock.json'],
		['cobol', 'cobol-lsp-assets.lock.json'],
		['bash', 'bash-lsp-assets.lock.json']
	]) {
		const lock = await json(new URL(lockFile, import.meta.url));
		if (!lock.assets || !Object.keys(lock.assets).length)
			throw new Error(`Missing pinned LSP output receipts: ${lockFile}`);
		add(`wasm-${directory}-lsp`, lock.assets);
	}
	const forth = await json(new URL('./forth-lsp.lock.json', import.meta.url));
	add('wasm-forth-lsp', { 'forth_lsp.wasm': forth.wasm });
	const php = await json(new URL('./phpantom-lsp-assets.lock.json', import.meta.url));
	add('wasm-phpantom-lsp', { 'phpantom_lsp.wasm': php.wasm, LICENSE: php.license });
	const postgres = await json(new URL('./postgresql-lsp-assets.lock.json', import.meta.url));
	add(
		'wasm-postgresql-lsp',
		Object.fromEntries(
			[...postgres.assets, { targetPath: 'LICENSE', ...postgres.license }].map((item) => [
				item.targetPath,
				{ bytes: item.size, sha256: item.sha256 }
			])
		)
	);
	const java = await json(new URL('./javacs-teavm-lsp-assets.lock.json', import.meta.url));
	const { JAVA_LANGUAGE_SERVER_ASSETS: bundledJava } = await loadBundledProfile(
		new URL('../packages/lsp/src/java/assets.generated.ts', import.meta.url)
	);
	if (JSON.stringify(bundledJava) !== JSON.stringify(java.assets))
		throw new Error('Java LSP consumer receipts differ from the producer lock');
	add('wasm-java-lsp', Object.fromEntries(java.assets.map((item) => [item.path, item])));
	return assets;
}

/**
 * Verify release bytes without building or running any language runtime.
 * Passing a manifest permits small fixtures/custom distributions; the CLI always uses
 * the committed core lock and separate LSP producer locks.
 * @param {{ buildDir?: string; staticDir?: string; manifest?: object; includeLsp?: boolean }} [options]
 */
export async function verifyPageAssets({
	buildDir = path.join(root, 'build'),
	staticDir = path.join(root, 'static'),
	manifest,
	includeLsp = manifest === undefined
} = {}) {
	const release = await json(path.join(root, 'package.json'));
	const core = await json(path.join(root, 'packages/core/package.json'));
	manifest ??= (
		await loadBundledProfile(
			new URL('../packages/core/src/runtime-asset-lock.generated.ts', import.meta.url)
		)
	).RUNTIME_ASSET_LOCK;
	if (
		manifest.schemaVersion !== 1 ||
		manifest.version !== release.version ||
		manifest.version !== core.version ||
		!manifest.assets ||
		typeof manifest.assets !== 'object' ||
		Array.isArray(manifest.assets)
	)
		throw new Error('Page asset lock must match the current package/core release version');
	const expected = { ...manifest.assets };
	const lsp = includeLsp ? await loadPinnedPageLspAssets() : {};
	for (const [name, entry] of Object.entries(lsp)) {
		if (Object.hasOwn(expected, name)) equalReceipt(expected[name], entry, name);
		else expected[name] = entry;
	}
	buildDir = await realpath(buildDir);
	const directories = new Set([buildDir]);
	async function regularFile(directory, name) {
		let current = directory;
		const parts = relative(name).split('/');
		for (const [index, part] of parts.entries()) {
			current = path.join(current, part);
			if (index < parts.length - 1 && directories.has(current)) continue;
			const info = await lstat(current).catch((error) => {
				if (error.code === 'ENOENT') throw new Error(`Missing page asset: ${name}`);
				throw error;
			});
			if (
				info.isSymbolicLink() ||
				(index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
			)
				throw new Error(`Non-regular page asset: ${name}`);
			if (index < parts.length - 1) directories.add(current);
		}
		return current;
	}
	async function optionalJson(name) {
		try {
			await lstat(path.join(buildDir, name));
		} catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
		const file = await regularFile(buildDir, name);
		if ((await lstat(file)).size > 8 * 1024 * 1024)
			throw new Error(`Oversized page asset index: ${name}`);
		return json(file);
	}
	const builtCompressedIndex = await optionalJson(compressedIndex);
	if (Object.hasOwn(expected, compressedIndex) && !builtCompressedIndex)
		throw new Error(`Missing page asset: ${compressedIndex}`);
	const compressed = builtCompressedIndex ?? { assets: [], sizes: {} };
	if (
		!Array.isArray(compressed.assets) ||
		!compressed.sizes ||
		typeof compressed.sizes !== 'object'
	)
		throw new Error('Invalid compressed page asset index');
	const compressedPaths = new Set();
	for (const name of compressed.assets) {
		relative(name);
		if (
			compressedPaths.has(name) ||
			!Number.isSafeInteger(compressed.sizes[name]) ||
			compressed.sizes[name] < 0
		)
			throw new Error(`Invalid or duplicate compressed page asset: ${name}`);
		compressedPaths.add(name);
	}
	if (Object.keys(compressed.sizes).some((name) => !compressedPaths.has(name)))
		throw new Error('Stale compressed page asset sizes');
	const layered = (await optionalJson(layeredIndex)) ?? {
		schemaVersion: 1,
		assets: {},
		layers: {}
	};
	if (layered.schemaVersion !== 1 || !layered.assets || !layered.layers)
		throw new Error('Invalid layered page asset index');
	const aliases = new Map();
	const compact = await optionalJson(compactIndex);
	if (compact) {
		if (
			compact.schemaVersion !== 1 ||
			compact.compacted !== true ||
			!Array.isArray(compact.aliases)
		)
			throw new Error('Invalid compact page asset receipt');
		const worker = await readFile(await regularFile(buildDir, 'worker.js'));
		if (
			hash(worker) !== compact.workerSha256 ||
			!worker.includes('/* wasm-idle compact runtime aliases v1 */')
		)
			throw new Error('Compact page asset worker receipt mismatch');
		for (const item of compact.aliases) {
			relative(item.from);
			relative(item.to);
			receipt(item, item.from);
			if (
				!/^wasm-[^/]+\/.+\.gz$/u.test(item.from) ||
				item.to !== `${item.from}.bin` ||
				aliases.has(item.from)
			)
				throw new Error(`Invalid compact page asset alias: ${item.from}`);
			aliases.set(item.from, item);
		}
	}
	const digests = new Map();
	async function digest(directory, name, limit, gzip = false) {
		const target = directory === buildDir ? (aliases.get(name)?.to ?? name) : name;
		const key = `${directory}/${target}:${gzip}`;
		if (!digests.has(key)) {
			const file = await regularFile(directory, target);
			const input = createReadStream(file);
			const stream = gzip ? input.pipe(createGunzip()) : input;
			if (gzip) input.on('error', (error) => stream.destroy(error));
			const sha = createHash('sha256');
			let bytes = 0;
			try {
				for await (const chunk of stream) {
					bytes += chunk.length;
					if (bytes > limit) throw new Error(`Page asset exceeds pinned size: ${name}`);
					sha.update(chunk);
				}
			} finally {
				input.destroy();
			}
			digests.set(key, { bytes, sha256: sha.digest('hex') });
		}
		return digests.get(key);
	}
	for (const [name, alias] of aliases)
		equalReceipt(await digest(buildDir, name, alias.bytes), alias, name);
	let logicalBytes = 0;
	const layers = new Map();
	for (const [name, entry] of Object.entries(expected)) {
		relative(name);
		receipt(entry, name);
		logicalBytes += entry.bytes;
		// Build compression adds app workers to this index; its original release
		// receipt still pins the producer index, and every runtime mapping is checked below.
		if (name === compressedIndex) {
			equalReceipt(await digest(staticDir, name, entry.bytes), entry, `static/${name}`);
			continue;
		}
		const item = layered.assets[name];
		if (entry.layer) {
			if (
				!item ||
				item.layer !== entry.layer.path ||
				item.offset !== entry.layer.offset ||
				item.length !== entry.bytes ||
				entry.layer.bytes !== entry.bytes
			)
				throw new Error(`Stale layered page asset entry: ${name}`);
		} else if (item) throw new Error(`Unexpected layered page asset entry: ${name}`);
		if (item) {
			if (compressedPaths.has(name))
				throw new Error(`Ambiguous page asset delivery: ${name}`);
			relative(item.layer);
			const group = layers.get(item.layer) ?? [];
			group.push([name, entry, item]);
			layers.set(item.layer, group);
			continue;
		}
		if (
			entry.deliveryPath &&
			(entry.deliveryPath !== `${name}.gz` || !compressedPaths.has(name))
		)
			throw new Error(`Missing compressed page asset mapping: ${name}`);
		if (compressedPaths.has(name) && compressed.sizes[name] !== entry.bytes)
			throw new Error(`Stale compressed page asset size: ${name}`);
		const delivery = compressedPaths.has(name) ? `${name}.gz` : name;
		equalReceipt(
			await digest(buildDir, delivery, entry.bytes, compressedPaths.has(name)),
			entry,
			name
		);
		if (entry.encoding === 'gzip')
			equalReceipt(
				await digest(buildDir, delivery, entry.uncompressedBytes, true),
				{ bytes: entry.uncompressedBytes, sha256: entry.uncompressedSha256 },
				`${name} (decoded)`
			);
	}
	for (const [name, entries] of layers) {
		const descriptor = layered.layers[name];
		if (
			!descriptor ||
			!Number.isSafeInteger(descriptor.length) ||
			descriptor.length < 0 ||
			descriptor.length > 16 * 1024 * 1024
		)
			throw new Error(`Invalid page runtime layer: ${name}`);
		equalReceipt(
			await digest(buildDir, name, descriptor.compressedLength),
			{ bytes: descriptor.compressedLength, sha256: descriptor.sha256 },
			name
		);
		const bytes = gunzipSync(
			await readFile(await regularFile(buildDir, aliases.get(name)?.to ?? name)),
			{ maxOutputLength: Math.max(1, descriptor.length) }
		);
		if (bytes.length !== descriptor.length)
			throw new Error(`Page runtime layer size mismatch: ${name}`);
		for (const [assetPath, expectedEntry, item] of entries) {
			if (
				!Number.isSafeInteger(item.offset) ||
				item.offset < 0 ||
				item.offset + item.length > bytes.length
			)
				throw new Error(`Invalid page runtime layer range: ${assetPath}`);
			const slice = bytes.subarray(item.offset, item.offset + item.length);
			equalReceipt({ bytes: slice.length, sha256: hash(slice) }, expectedEntry, assetPath);
		}
	}
	return {
		version: manifest.version,
		assetCount: Object.keys(expected).length,
		lspAssetCount: Object.keys(lsp).length,
		logicalBytes
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length > 3) throw new Error('Usage: verify-page-assets.mjs [build|directory]');
	console.log(
		await verifyPageAssets({ buildDir: path.resolve(root, process.argv[2] || 'build') })
	);
}
