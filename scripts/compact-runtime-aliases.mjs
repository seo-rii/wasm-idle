import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptFile = 'compact-runtime-aliases.v1.json';
const marker = '/* wasm-idle compact runtime aliases v1 */';
/** @typedef {{ from: string, to: string, bytes: number, sha256: string }} AliasReceipt */
/** @typedef {{ schemaVersion: number, aliases: AliasReceipt[], removedBytes: number, compacted: boolean, workerSha256?: string }} CompactReceipt */
/** @param {string | Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A recorded path may have acquired a symlink since the initial tree scan.
 * Check every component without following links before reading or deleting it.
 * @param {string} root
 * @param {string} relative
 */
async function regularCompactAssetPath(root, relative) {
	const parts = relative.split('/');
	let current = root;
	for (const [index, part] of parts.entries()) {
		if (!part || part === '.' || part === '..' || /[\\\0]/u.test(part)) {
			throw new Error('Invalid compact alias receipt path');
		}
		current = path.join(current, part);
		const stats = await lstat(current);
		const expectedType = index === parts.length - 1 ? stats.isFile() : stats.isDirectory();
		if (!expectedType || stats.isSymbolicLink()) {
			throw new Error(`Refusing a non-regular compact asset path: ${relative}`);
		}
	}
	return current;
}

/** @param {string} root @param {string} relative @returns {Promise<string[]>} */
async function collectGzipAliases(root, relative = '') {
	const files = [];
	for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
		const name = path.posix.join(relative, entry.name);
		// Do not traverse symlinks or remove files outside the generated tree.
		if (entry.isDirectory()) files.push(...(await collectGzipAliases(root, name)));
		else if (entry.isFile() && name.endsWith('.gz.bin')) files.push(name);
	}
	return files.sort();
}

/** @param {string} source @param {AliasReceipt[]} aliases */
function patchWorker(source, aliases) {
	const pipeline = '(await fetchDynamicModule(event.request, url)) ||';
	const compressedFetch = 'const compressedResponse = await fetch(compressedUrl, {';
	for (const anchor of [pipeline, compressedFetch]) {
		if (source.split(anchor).length !== 2) {
			throw new Error(`Unsupported generated service worker; expected one ${anchor}`);
		}
	}
	const entries = aliases.map(({ from, to }) => [from, to]);
	const helper = `${marker}
const compactRuntimeAliases = new Map(${JSON.stringify(entries)});

function compactRuntimeAliasUrl(url) {
	const scope = new URL(self.registration.scope);
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
	const target = compactRuntimeAliases.get(url.pathname.slice(scope.pathname.length));
	if (!target) return null;
	const result = new URL(target, scope);
	result.search = url.search;
	return result;
}

async function fetchCompactRuntimeAlias(request, url) {
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	const target = compactRuntimeAliasUrl(url);
	if (!target) return null;
	const response = await fetch(target, {
		method: request.method,
		cache: request.cache,
		credentials: request.credentials,
		headers: request.headers,
		mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
		redirect: request.redirect,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		signal: request.signal
	});
	const headers = new Headers(response.headers);
	headers.set('content-type', 'application/gzip');
	return new Response(request.method === 'HEAD' ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

`;
	return (
		helper +
		source
			.replace(
				pipeline,
				`${pipeline}\n\t\t\t\t\t(await fetchCompactRuntimeAlias(event.request, url)) ||`
			)
			.replace(
				compressedFetch,
				'const compressedResponse = await fetch(compactRuntimeAliasUrl(compressedUrl) || compressedUrl, {'
			)
	);
}

/**
 * Compact only generated deployment output. The explicit flag accepts removal of
 * legacy direct URLs for clients that are not controlled by this service worker.
 * Producer inputs and default builds retain both URLs.
 * @param {string} buildDir
 * @param {{ dropLegacyAliases?: boolean }} options
 */
export async function compactRuntimeAliases(buildDir, { dropLegacyAliases = false } = {}) {
	const root = await realpath(path.resolve(buildDir));
	const staticRoot = await realpath(path.join(repoRoot, 'static'));
	if (root === staticRoot || root.startsWith(`${staticRoot}${path.sep}`)) {
		throw new Error(
			'Refusing to compact producer inputs in static; use generated build output'
		);
	}
	if (!(await lstat(path.join(root, '_app'))).isDirectory()) {
		throw new Error('Expected generated build output with an _app directory');
	}
	const workerPath = path.join(root, 'worker.js');
	if (!(await lstat(workerPath)).isFile())
		throw new Error('Expected a regular generated worker.js');
	const workerSource = await readFile(workerPath, 'utf8');
	const previous = await readFile(path.join(root, receiptFile), 'utf8')
		.then((text) => /** @type {CompactReceipt} */ (JSON.parse(text)))
		.catch((error) => {
			if (error.code !== 'ENOENT') throw error;
			return null;
		});
	if (workerSource.includes(marker)) {
		if (
			!previous ||
			previous.schemaVersion !== 1 ||
			!Array.isArray(previous.aliases) ||
			previous.workerSha256 !== sha256(workerSource)
		) {
			throw new Error('Compact worker receipt does not match; rebuild the deployment output');
		}
		const remainingAliases = [];
		for (const alias of previous.aliases) {
			if (
				!/^wasm-[^/]+\/.+\.gz$/.test(alias.from) ||
				alias.to !== `${alias.from}.bin` ||
				alias.from.split('/').some((segment) => segment === '..' || segment === '.')
			) {
				throw new Error('Invalid compact alias receipt path');
			}
			const canonicalPath = await regularCompactAssetPath(root, alias.to);
			const bytes = await readFile(canonicalPath);
			if (bytes.length !== alias.bytes || sha256(bytes) !== alias.sha256) {
				throw new Error(`Compact canonical asset changed: ${alias.to}`);
			}
			const legacyPath = await regularCompactAssetPath(root, alias.from).catch((error) => {
				if (error.code !== 'ENOENT') throw error;
				return null;
			});
			if (!legacyPath) continue;
			const legacyBytes = await readFile(legacyPath);
			if (legacyBytes.length !== alias.bytes || sha256(legacyBytes) !== alias.sha256) {
				throw new Error(`Compact legacy asset changed: ${alias.from}`);
			}
			remainingAliases.push(legacyPath);
		}
		if (remainingAliases.length && !dropLegacyAliases) {
			throw new Error('Compact deletion is incomplete; rerun with --drop-legacy-aliases');
		}
		// A receipt can precede an interrupted deletion. Verify every remaining file
		// before resuming so a mismatched alias cannot cause a partial retry.
		for (const legacyPath of remainingAliases) await rm(legacyPath);
		return { ...previous, compacted: true };
	}
	if (previous)
		throw new Error('Compact receipt exists without its worker; rebuild the deployment output');
	const aliases = [];
	for (const to of await collectGzipAliases(root)) {
		if (!to.startsWith('wasm-')) continue;
		const from = to.slice(0, -4);
		const file = path.join(root, from);
		const stats = await lstat(file).catch((error) => {
			if (error.code !== 'ENOENT') throw error;
			return null;
		});
		if (!stats) continue;
		if (!stats.isFile()) throw new Error(`Refusing a non-regular gzip alias: ${from}`);
		const [legacy, canonical] = await Promise.all([
			readFile(file),
			readFile(path.join(root, to))
		]);
		if (!legacy.equals(canonical))
			throw new Error(`Gzip alias bytes differ: ${from} and ${to}`);
		if (legacy.length < 18 || legacy[0] !== 0x1f || legacy[1] !== 0x8b || legacy[2] !== 8) {
			throw new Error(`Invalid gzip alias: ${from}`);
		}
		aliases.push({ from, to, bytes: legacy.length, sha256: sha256(legacy) });
	}
	const report = {
		schemaVersion: 1,
		aliases,
		removedBytes: aliases.reduce((total, alias) => total + alias.bytes, 0),
		compacted: dropLegacyAliases && aliases.length > 0
	};
	if (!report.compacted) return report;
	// Validate every candidate and both worker anchors before changing any file.
	const generatedWorker = patchWorker(workerSource, aliases);
	const receipt = { ...report, workerSha256: sha256(generatedWorker) };
	const suffix = `.compact-${process.pid}.tmp`;
	await writeFile(`${workerPath}${suffix}`, generatedWorker);
	await rename(`${workerPath}${suffix}`, workerPath);
	const receiptPath = path.join(root, receiptFile);
	await writeFile(`${receiptPath}${suffix}`, `${JSON.stringify(receipt, null, '\t')}\n`);
	await rename(`${receiptPath}${suffix}`, receiptPath);
	// The alias handler is in place before the first old file disappears.
	for (const alias of aliases) await rm(path.join(root, alias.from));
	return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const flags = args.filter((argument) => argument.startsWith('--'));
	if (
		flags.some((flag) => flag !== '--drop-legacy-aliases') ||
		args.filter((a) => !a.startsWith('--')).length > 1
	) {
		throw new Error(
			'Usage: node scripts/compact-runtime-aliases.mjs [build] [--drop-legacy-aliases]'
		);
	}
	const buildDir = args.find((argument) => !argument.startsWith('--')) ?? 'build';
	const report = await compactRuntimeAliases(path.resolve(repoRoot, buildDir), {
		dropLegacyAliases: flags.includes('--drop-legacy-aliases')
	});
	console.log(JSON.stringify(report, null, 2));
}
