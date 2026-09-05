import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';
import { prepareOcamlBrowserWrapper } from './prepare-ocaml-browser-wrapper.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'scripts', 'browser-test-assets.v1.json');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');
const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, '.cache', 'browser-test-assets');
const SUPPORTED_GROUPS = new Set(['all', 'clang', 'clangd', 'ocaml']);

/**
 * @typedef {{
 *   group: 'clang' | 'clangd' | 'ocaml';
 *   source: string;
 *   target: string;
 *   size: number;
 *   sha256: string;
 * }} BrowserTestAsset
 */

/**
 * @typedef {{
 *   format: 'wasm-idle-browser-test-assets-v1';
 *   defaultBaseUrl: string;
 *   assets: BrowserTestAsset[];
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
	const seen = new Set();
	for (const asset of value.assets) {
		if (
			!isObject(asset) ||
			!['clang', 'clangd', 'ocaml'].includes(String(asset.group)) ||
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
	if (requested.includes('all')) return ['clang', 'ocaml'];
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
 *   bypassCookie?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
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
	bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '',
	fetchImpl = fetch,
	timeoutMs = 120_000
} = {}) {
	const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
	const selectedGroups = normalizeBrowserTestAssetGroups(groups);
	const resolvedBaseUrl = normalizeBaseUrl(
		baseUrl || process.env.WASM_IDLE_TEST_ASSET_BASE_URL || manifest.defaultBaseUrl
	);
	let downloaded = 0;
	let reused = 0;

	for (const group of selectedGroups) {
		const assets = manifest.assets.filter((candidate) => candidate.group === group);
		const inputRoot =
			group === 'ocaml'
				? path.join(
						cacheDir,
						createHash('sha256').update(JSON.stringify(assets)).digest('hex')
					)
				: staticDir;
		const result = await installAssets(assets, inputRoot, resolvedBaseUrl, {
			bypassCookie,
			fetchImpl,
			timeoutMs
		});
		downloaded += result.downloaded;
		reused += result.reused;
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
		reused
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareBrowserTestAssets({ groups: process.argv.slice(2) });
	console.log(
		`Prepared browser test assets for ${result.groups.join(', ')} from ${result.baseUrl} (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
