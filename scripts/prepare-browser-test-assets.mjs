import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';
import { prepareOcamlBrowserWrapper } from './prepare-ocaml-browser-wrapper.mjs';
import { prepareClangdAssets } from './prepare-clangd-assets.mjs';
import { loadBundledProfile } from './verify-pinned-runtime-assets.mjs';
import { computeBundleFingerprint } from './sync-wasm-of-js-of-ocaml.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'browser-test-assets.v1.json');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');
const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'browser-test-assets');
const ASSET_GROUPS = ['clang', 'clangd', 'ocaml', 'c3', 'lfortran', 'lean4', 'commonlisp'];
const SUPPORTED_GROUPS = new Set(['all', ...ASSET_GROUPS]);

/**
 * @typedef {{
 *   group: string;
 *   source: string;
 *   target: string;
 *   size: number;
 *   sha256: string;
 *   decoded?: { size: number; sha256: string };
 * }} BrowserTestAsset
 */

/**
 * @typedef {{
 *   format: 'wasm-idle-browser-test-assets-v1';
 *   defaultBaseUrl: string;
 *   assets: BrowserTestAsset[];
 *   groupBaseUrls?: Record<string, string>;
 * }} BrowserTestAssetManifest
 */

/** @param {string} value */
function normalizeBaseUrl(value) {
	const url = new URL(value);
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function parseManifest(value) {
	if (
		!isObject(value) ||
		value.format !== 'wasm-idle-browser-test-assets-v1' ||
		typeof value.defaultBaseUrl !== 'string' ||
		!Array.isArray(value.assets)
	) {
		throw new Error('browser test asset manifest has an invalid root shape');
	}
	if (value.groupBaseUrls !== undefined) {
		if (!isObject(value.groupBaseUrls)) throw new Error('Invalid browser asset group URLs');
		for (const [group, baseUrl] of Object.entries(value.groupBaseUrls)) {
			if (!ASSET_GROUPS.includes(group) || typeof baseUrl !== 'string')
				throw new Error('Invalid browser asset group URL');
			normalizeBaseUrl(baseUrl);
		}
	}
	const seen = new Set();
	for (const asset of value.assets) {
		if (
			!isObject(asset) ||
			!ASSET_GROUPS.includes(String(asset.group)) ||
			typeof asset.source !== 'string' ||
			asset.source.length === 0 ||
			typeof asset.target !== 'string' ||
			asset.target.length === 0 ||
			typeof asset.size !== 'number' ||
			!Number.isSafeInteger(asset.size) ||
			asset.size < 0 ||
			typeof asset.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/u.test(asset.sha256)
		) {
			throw new Error('browser test asset manifest contains invalid asset metadata');
		}
		if (
			asset.decoded !== undefined &&
			(!isObject(asset.decoded) ||
				!Number.isSafeInteger(asset.decoded.size) ||
				Number(asset.decoded.size) <= 0 ||
				typeof asset.decoded.sha256 !== 'string' ||
				!/^[0-9a-f]{64}$/u.test(asset.decoded.sha256))
		) {
			throw new Error('browser test asset manifest contains invalid decoded metadata');
		}
		const key = `${asset.group}\0${asset.target}`;
		if (seen.has(key))
			throw new Error(`duplicate browser test asset: ${asset.group}/${asset.target}`);
		seen.add(key);
	}
	return /** @type {BrowserTestAssetManifest} */ (value);
}

/** @param {BrowserTestAsset[]} assets @param {string} targetRoot @param {URL} baseUrl @param {{ bypassCookie: string; fetchImpl: typeof fetch; timeoutMs: number }} options */
async function installAssets(assets, targetRoot, baseUrl, { bypassCookie, fetchImpl, timeoutMs }) {
	return preparePinnedAssets({
		assets: assets.map((asset) => ({
			sourcePath: asset.source,
			targetPath: asset.target,
			size: asset.size,
			sha256: asset.sha256
		})),
		targetRoot,
		sourceBaseUrl: baseUrl.href,
		label: 'browser test',
		userAgent: 'wasm-idle-browser-test-assets',
		bypassCookie,
		fetchImpl,
		timeoutMs
	});
}

/** @param {string[]} groups */
export function normalizeBrowserTestAssetGroups(groups) {
	const positionalGroups = groups[0] === '--' ? groups.slice(1) : groups;
	const requested = positionalGroups.length > 0 ? positionalGroups : ['all'];
	for (const group of requested) {
		if (!SUPPORTED_GROUPS.has(group))
			throw new Error(`Unknown browser test asset group: ${group}`);
	}
	if (requested.includes('all')) return ASSET_GROUPS.filter((group) => group !== 'clangd');
	return [...new Set(requested)];
}

/**
 * @param {{
 *   groups?: string[];
 *   manifestPath?: string;
 *   staticDir?: string;
 *   cacheDir?: string;
 *   versionModulePath?: string;
 *   prepareOcamlWrapper?: (options: { sourceRoot: string; staticDir: string; versionModulePath?: string }) => Promise<unknown>;
 *   baseUrl?: string;
 *   clangdSourceDir?: string;
 *   clangdReceiptPath?: string;
 *   bypassCookie?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 *   prepareLean4?: typeof import('./sync-wasm-lean4.mjs').syncWasmLean4Assets;
 *   prepareCommonLisp?: typeof import('./sync-wasm-commonlisp.mjs').syncWasmCommonLispAssets;
 * }} [options]
 */
export async function prepareBrowserTestAssets({
	groups = ['all'],
	manifestPath = DEFAULT_MANIFEST_PATH,
	staticDir = DEFAULT_STATIC_DIR,
	cacheDir = DEFAULT_CACHE_DIR,
	versionModulePath,
	prepareOcamlWrapper = prepareOcamlBrowserWrapper,
	baseUrl,
	clangdSourceDir = manifestPath === DEFAULT_MANIFEST_PATH &&
	!baseUrl &&
	!process.env.WASM_IDLE_TEST_ASSET_BASE_URL
		? process.env.WASM_IDLE_TEST_CLANGD_SOURCE_DIR
		: undefined,
	clangdReceiptPath,
	bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '',
	fetchImpl = fetch,
	timeoutMs = 120_000,
	prepareLean4 = async (options) =>
		(await import('./sync-wasm-lean4.mjs')).syncWasmLean4Assets(options),
	prepareCommonLisp = async (options) =>
		(await import('./sync-wasm-commonlisp.mjs')).syncWasmCommonLispAssets(options)
} = {}) {
	const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
	const selectedGroups = normalizeBrowserTestAssetGroups(groups);
	const compressionManifest = path.join(staticDir, 'compressed-runtime-assets.v1.json');
	const compressedTargets = (await stat(compressionManifest).catch(() => null))
		? new Set(JSON.parse(await readFile(compressionManifest, 'utf8')).assets)
		: new Set();
	const resolvedBaseUrl = normalizeBaseUrl(
		baseUrl || process.env.WASM_IDLE_TEST_ASSET_BASE_URL || manifest.defaultBaseUrl
	);
	let downloaded = 0;
	let reused = 0;
	let copied = 0;
	let preparedClangd = false;
	const useCurrentClangdReceipt =
		!!clangdSourceDir ||
		(manifestPath === DEFAULT_MANIFEST_PATH &&
			!baseUrl &&
			!process.env.WASM_IDLE_TEST_ASSET_BASE_URL);

	for (const group of selectedGroups) {
		if (group === 'lean4' || group === 'commonlisp') {
			const prepareRuntime = group === 'lean4' ? prepareLean4 : prepareCommonLisp;
			await prepareRuntime({ targetDir: path.join(staticDir, `wasm-${group}`), fetchImpl });
			continue;
		}
		if (
			useCurrentClangdReceipt &&
			(group === 'clang' || group === 'clangd') &&
			!preparedClangd
		) {
			const result = await prepareClangdAssets({
				receiptPath: clangdReceiptPath || path.join(staticDir, 'clang/runtime-build.json'),
				staticDir,
				sourceDir: clangdSourceDir,
				bypassCookie,
				fetchImpl,
				timeoutMs
			});
			downloaded += result.downloaded;
			reused += result.reused;
			if ('copied' in result && typeof result.copied === 'number') copied += result.copied;
			preparedClangd = true;
		}
		const assets = manifest.assets.filter(
			(candidate) =>
				candidate.group === group &&
				!(useCurrentClangdReceipt && candidate.target.startsWith('clangd/'))
		);
		const inputRoot =
			group === 'ocaml'
				? path.join(
						cacheDir,
						createHash('sha256').update(JSON.stringify(assets)).digest('hex')
					)
				: staticDir;
		const groupBaseUrl = normalizeBaseUrl(
			baseUrl ||
				process.env.WASM_IDLE_TEST_ASSET_BASE_URL ||
				manifest.groupBaseUrls?.[group] ||
				resolvedBaseUrl.href
		);
		const directAssets = assets.filter((asset) => !asset.decoded);
		const result = await installAssets(directAssets, inputRoot, groupBaseUrl, {
			bypassCookie,
			fetchImpl,
			timeoutMs
		});
		downloaded += result.downloaded;
		reused += result.reused;
		for (const asset of assets.filter((asset) => asset.decoded)) {
			const receipt = /** @type {{ size: number; sha256: string }} */ (asset.decoded);
			const encodedRoot = path.join(cacheDir, 'encoded');
			const result = await installAssets([asset], encodedRoot, groupBaseUrl, {
				bypassCookie,
				fetchImpl,
				timeoutMs
			});
			const encoded = await readFile(path.join(encodedRoot, asset.target));
			const bytes = gunzipSync(encoded, {
				maxOutputLength: receipt.size
			});
			if (
				bytes.length !== receipt.size ||
				createHash('sha256').update(bytes).digest('hex') !== receipt.sha256
			) {
				throw new Error(
					`Decoded browser test asset failed receipt validation: ${asset.target}`
				);
			}
			const target = path.resolve(inputRoot, asset.target);
			if (!target.startsWith(path.resolve(inputRoot) + path.sep))
				throw new Error('Decoded browser test asset escapes the target directory');
			await mkdir(path.dirname(target), { recursive: true });
			if (compressedTargets.has(asset.target)) {
				await writeFile(`${target}.gz`, encoded);
				await rm(target, { force: true });
			} else {
				await writeFile(target, bytes);
			}
			downloaded += result.downloaded;
			reused += result.reused;
		}
		if (group === 'ocaml') {
			await prepareOcamlWrapper({
				sourceRoot: inputRoot,
				staticDir,
				...(versionModulePath ? { versionModulePath } : {})
			});
		}
	}

	return {
		baseUrl: resolvedBaseUrl.href,
		downloaded,
		groups: selectedGroups,
		reused,
		...(copied ? { copied } : {})
	};
}

/** Check the bytes that the selected suites will actually serve, including reused builds.
 * @param {{ groups: string[]; staticDir?: string; manifestPath?: string }} options
 */
export async function verifyBrowserTestAssets({
	groups,
	staticDir = DEFAULT_STATIC_DIR,
	manifestPath = DEFAULT_MANIFEST_PATH
}) {
	const selectedGroups = normalizeBrowserTestAssetGroups(groups);
	const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
	const receipts = manifest.assets
		.filter((asset) => selectedGroups.includes(asset.group) && asset.group !== 'ocaml')
		.map((asset) => ({ target: asset.target, ...(asset.decoded || asset) }));
	if (selectedGroups.includes('ocaml')) {
		const { WASM_OCAML_RUNTIME_PROFILE: profile } = await loadBundledProfile(
			new URL('../src/lib/playground/wasmOcamlVersion.ts', import.meta.url)
		);
		const fingerprint = await computeBundleFingerprint(
			[
				path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native'),
				path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native-bundle')
			],
			{
				compressedManifestPath: path.join(staticDir, 'compressed-runtime-assets.v1.json'),
				preserveCompressedPaths: manifest.assets
					.filter((asset) => asset.group === 'ocaml')
					.map((asset) => path.join(staticDir, asset.target))
			}
		);
		if (fingerprint !== profile.fingerprint)
			throw new Error('Required OCaml browser bundle fingerprint mismatch');
	}
	for (const group of ['lean4', 'commonlisp']) {
		if (!selectedGroups.includes(group)) continue;
		const exports = await loadBundledProfile(
			new URL(
				`../src/lib/playground/wasm${group === 'lean4' ? 'Lean4' : 'CommonLisp'}Version.ts`,
				import.meta.url
			)
		);
		const profile =
			exports[group === 'lean4' ? 'WASM_LEAN4_PROFILE' : 'WASM_COMMONLISP_PROFILE'];
		const lock = JSON.parse(
			await readFile(new URL(`./wasm-${group}-assets.lock.json`, import.meta.url), 'utf8')
		);
		for (const [name, receipt] of Object.entries({
			...profile.assets,
			...lock.notices,
			'runner-worker.js': profile.workerReceipt
		})) {
			const storedName =
				group === 'commonlisp' && name === 'ecl.wasm.gz' ? 'ecl.wasm.gz.bin' : name;
			receipts.push({
				target: `wasm-${group}/${storedName}`,
				size: receipt.bytes,
				sha256: receipt.sha256
			});
		}
	}
	const compressedPath = path.join(staticDir, 'compressed-runtime-assets.v1.json');
	const compressed = (await stat(compressedPath).catch(() => null))
		? new Set(JSON.parse(await readFile(compressedPath, 'utf8')).assets)
		: new Set();
	for (const receipt of receipts) {
		const target = path.resolve(staticDir, receipt.target);
		if (!target.startsWith(path.resolve(staticDir) + path.sep))
			throw new Error('Browser test asset escapes the target directory');
		const stored = target + (compressed.has(receipt.target) ? '.gz' : '');
		const metadata = await stat(stored).catch(() => null);
		if (!metadata?.isFile() || metadata.size > receipt.size + 65_536)
			throw new Error(`Missing or oversized required browser test asset: ${receipt.target}`);
		const encoded = await readFile(stored);
		const bytes = compressed.has(receipt.target)
			? gunzipSync(encoded, { maxOutputLength: receipt.size })
			: encoded;
		if (
			bytes.length !== receipt.size ||
			createHash('sha256').update(bytes).digest('hex') !== receipt.sha256
		)
			throw new Error(`Required browser test asset size/SHA-256 mismatch: ${receipt.target}`);
	}
	return { groups: selectedGroups, assetCount: receipts.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareBrowserTestAssets({ groups: process.argv.slice(2) });
	console.log(
		`Prepared browser test assets for ${result.groups.join(', ')} from ${result.baseUrl} (${result.downloaded} downloaded, ${'copied' in result ? result.copied : 0} copied, ${result.reused} reused).`
	);
}
