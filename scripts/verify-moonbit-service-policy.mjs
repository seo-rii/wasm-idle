import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRecords = new Set([
	'upstream.json',
	'COMPILER-LICENSE.txt',
	'CORE-LICENSE.txt',
	'CORE-NOTICE.txt',
	'runner-worker.js'
]);
const indexes = [
	'compressed-runtime-assets.v1.json',
	'layered-runtime-assets.v1.json',
	'compact-runtime-aliases.v1.json'
];
const maxIndexBytes = 8 * 1024 * 1024;

/** @param {string} detail @returns {never} */
function blocked(detail) {
	throw new Error(
		'MoonBit publication is blocked pending MPSL §14 service-license review: ' +
			detail +
			'. Keep local research payloads outside publication trees; see docs/moonbit.md. ' +
			'Local-research and skip/reuse flags do not authorize publication.'
	);
}

/** @param {unknown} value @returns {boolean} */
function hasMoonbitReference(value) {
	if (typeof value === 'string') {
		let text = value;
		try {
			text = decodeURIComponent(text);
		} catch {
			// An undecodable value can still contain a literal reference.
		}
		return text.toLowerCase().includes('wasm-moonbit');
	}
	if (Array.isArray(value)) return value.some(hasMoonbitReference);
	return (
		value !== null &&
		typeof value === 'object' &&
		Object.entries(value).some(
			([key, entry]) => hasMoonbitReference(key) || hasMoonbitReference(entry)
		)
	);
}

/** Check publication inputs without downloading, deleting, or changing runtime assets.
 * There is deliberately no environment/CLI permission override.
 * @param {{ rootDir?: string }} [options]
 */
export async function verifyMoonbitServicePolicy({ rootDir = path.join(repoRoot, 'static') } = {}) {
	const directory = path.join(rootDir, 'wasm-moonbit');
	const info = await lstat(directory).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	});
	if (info) {
		if (!info.isDirectory() || info.isSymbolicLink())
			blocked('non-regular wasm-moonbit directory');
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (!sourceRecords.has(entry.name) || !entry.isFile())
				blocked(`unreviewed asset wasm-moonbit/${entry.name}`);
		}
	}
	for (const name of indexes) {
		for (const suffix of ['', '.gz']) {
			const file = path.join(rootDir, name + suffix);
			const indexInfo = await lstat(file).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			if (!indexInfo) continue;
			if (!indexInfo.isFile() || indexInfo.isSymbolicLink() || indexInfo.size > maxIndexBytes)
				blocked('uninspectable delivery index ' + name + suffix);
			const stored = await readFile(file);
			const bytes = suffix ? gunzipSync(stored, { maxOutputLength: maxIndexBytes }) : stored;
			if (hasMoonbitReference(JSON.parse(bytes.toString('utf8'))))
				blocked('MoonBit delivery reference in ' + name + suffix);
		}
	}
	// Compact aliases are also embedded in the generated service Worker. Inspect
	// it even if someone removed its sidecar receipt after an earlier build.
	for (const name of ['worker.js', 'worker.js.gz']) {
		const file = path.join(rootDir, name);
		const workerInfo = await lstat(file).catch((error) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
		if (!workerInfo) continue;
		if (!workerInfo.isFile() || workerInfo.isSymbolicLink() || workerInfo.size > maxIndexBytes)
			blocked('uninspectable generated service Worker ' + name);
		const stored = await readFile(file);
		const bytes = name.endsWith('.gz')
			? gunzipSync(stored, { maxOutputLength: maxIndexBytes })
			: stored;
		if (hasMoonbitReference(bytes.toString('utf8')))
			blocked('MoonBit delivery reference in generated service Worker ' + name);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [target = 'static', ...extra] = process.argv.slice(2);
		if (!['static', 'build'].includes(target) || extra.length)
			throw new Error('Usage: node scripts/verify-moonbit-service-policy.mjs [static|build]');
		await verifyMoonbitServicePolicy({ rootDir: path.join(repoRoot, target) });
		console.log('MoonBit publication policy verified: compiler payloads are withheld.');
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
