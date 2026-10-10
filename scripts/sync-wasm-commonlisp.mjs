import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { format } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
/** @param {Uint8Array} bytes */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
/** Release name -> static name. `.bin` keeps static hosts from adding Content-Encoding.
 * @type {Record<string, string>} */
const STORAGE_NAMES = { 'ecl.wasm.gz': 'ecl.wasm.gz.bin' };

/** @returns {Promise<any>} */
export async function readCommonLispLock() {
	return JSON.parse(
		await readFile(new URL('./wasm-commonlisp-assets.lock.json', import.meta.url), 'utf8')
	);
}

/** The pinned wasm-llvm commit that publishes `artifacts/ecl-browser/`. */
export function commonLispReleaseBaseUrl(/** @type {{ producerRevision: string }} */ lock) {
	if (!/^[0-9a-f]{40}$/u.test(lock.producerRevision))
		throw new Error('Common Lisp lock must pin a 40-character wasm-llvm commit.');
	return `https://raw.githubusercontent.com/seo-rii/wasm-llvm/${lock.producerRevision}/artifacts/ecl-browser/`;
}

/**
 * @param {string} name
 * @param {{ sourceDir?: string; fetchImpl?: typeof fetch; lock: any }} options
 */
async function readAsset(name, { sourceDir, fetchImpl, lock }) {
	const receipt = lock.assets[name] ?? lock.notices[name];
	const upstream = receipt.upstream ?? name;
	if (sourceDir) {
		const file = path.join(sourceDir, upstream);
		const stat = await lstat(file);
		if (!stat.isFile() || stat.size !== receipt.bytes)
			throw new Error(`Common Lisp ${name} size/type mismatch.`);
		return new Uint8Array(await readFile(file));
	}
	const url = new URL(upstream, commonLispReleaseBaseUrl(lock)).href;
	const response = await (fetchImpl ?? fetch)(url, {
		redirect: 'error',
		signal: AbortSignal.timeout(120_000)
	});
	if (!response.ok) throw new Error(`Common Lisp ${name} download failed: ${response.status}`);
	const declared = Number(response.headers.get('content-length') ?? receipt.bytes);
	if (declared > MAX_ASSET_BYTES) throw new Error(`Common Lisp ${name} is too large.`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length !== receipt.bytes) throw new Error(`Common Lisp ${name} size/type mismatch.`);
	return bytes;
}

// The reviewed lock pins the wasm-llvm revision and every producer byte. A different build
// requires an explicit lock update, never trust-on-sync.
/** @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string; fetchImpl?: typeof fetch }} options */
export async function syncWasmCommonLispAssets({
	sourceDir,
	targetDir = path.join(root, 'static/wasm-commonlisp'),
	versionModulePath = path.join(root, 'src/lib/playground/wasmCommonLispVersion.ts'),
	fetchImpl
} = {}) {
	const lock = await readCommonLispLock();
	const verified = new Map();
	for (const [name, receipt] of Object.entries({ ...lock.assets, ...lock.notices })) {
		const bytes = await readAsset(name, { sourceDir, fetchImpl, lock });
		if (digest(bytes) !== receipt.sha256)
			throw new Error(`Common Lisp ${name} SHA-256 mismatch.`);
		verified.set(name, bytes);
	}
	let wasm;
	try {
		wasm = gunzipSync(verified.get('ecl.wasm.gz'), { maxOutputLength: MAX_ASSET_BYTES });
	} catch (error) {
		throw new Error('Common Lisp ecl.wasm.gz is not valid gzip data.', { cause: error });
	}
	if (
		wasm.length !== lock.runtime['ecl.wasm'].bytes ||
		digest(wasm) !== lock.runtime['ecl.wasm'].sha256
	)
		throw new Error('Common Lisp decompressed ecl.wasm does not match the reviewed lock.');
	const receipt = JSON.parse(new TextDecoder().decode(verified.get('producer-receipt.json')));
	if (
		receipt.producerId !== 'wasm-llvm/ecl-browser' ||
		receipt.sources?.ecl?.commit !== lock.source ||
		receipt.sources?.ecl?.version !== lock.version ||
		receipt.smoke?.checks?.stdinStdout !== true ||
		receipt.browserSmoke?.checks?.stdinStdout !== true ||
		receipt.assets?.['ecl.wasm']?.sha256 !== lock.runtime['ecl.wasm'].sha256 ||
		receipt.delivery?.['ecl.wasm.gz']?.sha256 !== lock.assets['ecl.wasm.gz'].sha256 ||
		receipt.delivery?.['ecl.wasm.gz']?.encoding !== 'gzip' ||
		receipt.assets?.['ecl.mjs']?.sha256 !== lock.assets['ecl.mjs'].sha256
	) {
		throw new Error('Common Lisp producer receipt does not match the reviewed ECL runtime.');
	}
	const workerSource = await readFile(
		new URL('./runtime-workers/wasm-commonlisp-runner-worker.js', import.meta.url),
		'utf8'
	);
	const placeholder = '__WASM_IDLE_COMMONLISP_ASSET_LOCK__';
	if (workerSource.split(placeholder).length !== 2)
		throw new Error('Common Lisp worker must contain exactly one asset-lock placeholder.');
	const runtimeLock = { ...lock };
	delete runtimeLock.notices;
	const worker = Buffer.from(workerSource.replace(placeholder, JSON.stringify(runtimeLock)));
	const workerReceipt = { bytes: worker.length, sha256: digest(worker) };
	const version = await format(
		`// Generated by sync:wasm-commonlisp from the reviewed asset lock.\nexport const WASM_COMMONLISP_PROFILE = ${JSON.stringify({ ...runtimeLock, workerReceipt }, null, '\t')} as const;\n`,
		{
			parser: 'typescript',
			printWidth: 100,
			singleQuote: true,
			tabWidth: 4,
			trailingComma: 'none',
			useTabs: true
		}
	);
	await publishCommonLispBundle({ targetDir, versionModulePath, verified, worker, version });
	return {
		targetDir: path.resolve(targetDir),
		producerRevision: lock.producerRevision,
		workerReceipt
	};
}

/** Publish an already-verified bundle and its profile as one rollback-safe transaction.
 * @param {{ targetDir: string; versionModulePath: string; verified: Map<string, Uint8Array>; worker: Uint8Array; version: string }} options
 */
export async function publishCommonLispBundle({
	targetDir,
	versionModulePath,
	verified,
	worker,
	version
}) {
	const staging = `${path.resolve(targetDir)}.staging-${randomUUID()}`;
	const backup = `${path.resolve(targetDir)}.backup-${randomUUID()}`;
	const stagedVersion = `${path.resolve(versionModulePath)}.staging-${randomUUID()}`;
	await mkdir(staging, { recursive: true });
	let moved = false;
	let published = false;
	let complete = false;
	try {
		for (const [name, bytes] of verified)
			await writeFile(path.join(staging, STORAGE_NAMES[name] ?? name), bytes);
		await writeFile(path.join(staging, 'runner-worker.js'), worker);
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await writeFile(stagedVersion, version, { flag: 'wx' });
		try {
			await rename(targetDir, backup);
			moved = true;
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
				throw error;
		}
		await rename(staging, targetDir);
		published = true;
		await rename(stagedVersion, versionModulePath);
		complete = true;
	} catch (error) {
		if (published) await rm(targetDir, { recursive: true, force: true });
		if (moved) await rename(backup, targetDir);
		throw error;
	} finally {
		await rm(staging, { recursive: true, force: true });
		await rm(stagedVersion, { force: true });
		if (complete && moved) await rm(backup, { recursive: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [flag, sourceDir, ...extra] = process.argv.slice(2);
	if (extra.length || (flag !== undefined && (flag !== '--source' || !sourceDir)))
		throw new Error(
			'Usage: sync-wasm-commonlisp.mjs [--source /path/to/artifacts/ecl-browser]'
		);
	const result = await syncWasmCommonLispAssets({ sourceDir });
	console.log(
		`Synced verified ECL runtime from wasm-llvm ${result.producerRevision} to ${result.targetDir}`
	);
}
