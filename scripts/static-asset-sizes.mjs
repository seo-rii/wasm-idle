import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'static');
const DEFAULT_BUDGET_FILE = path.join(REPO_ROOT, 'scripts/static-asset-budgets.v1.json');
const PRECOMPRESSED_EXTENSIONS = new Set(['.br', '.brotli', '.gz', '.tgz', '.zip', '.zst']);
const RUNTIME_DIRECTORIES = new Set([
	'clang',
	'clangd',
	'lsp',
	'pyodide',
	'shared',
	'teavm',
	'webr'
]);

/** @typedef {{ bytes: number; compressedBytes: number; files: number }} AssetMeasurement */
/** @typedef {{ maxBytes: number; maxFiles: number; optional: boolean }} AssetBudget */

/** @param {string} filePath */
function isPrecompressed(filePath) {
	return PRECOMPRESSED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** @param {string} directoryName */
export function isRuntimeAssetDirectory(directoryName) {
	return directoryName.startsWith('wasm-') || RUNTIME_DIRECTORIES.has(directoryName);
}

/** @param {string} rootDir */
async function measureTree(rootDir) {
	/** @type {AssetMeasurement} */
	const measurement = { bytes: 0, compressedBytes: 0, files: 0 };
	for (const entry of await readdir(rootDir, { withFileTypes: true })) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			const child = await measureTree(entryPath);
			measurement.bytes += child.bytes;
			measurement.compressedBytes += child.compressedBytes;
			measurement.files += child.files;
			continue;
		}
		if (!entry.isFile()) continue;
		const fileSize = (await stat(entryPath)).size;
		measurement.bytes += fileSize;
		measurement.files += 1;
		if (isPrecompressed(entryPath)) measurement.compressedBytes += fileSize;
	}
	return measurement;
}

/** @param {string} rootDir */
export async function measureStaticAssets(rootDir = DEFAULT_ROOT) {
	const total = await measureTree(rootDir);
	/** @type {Record<string, AssetMeasurement>} */
	const directories = {};
	for (const entry of await readdir(rootDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		directories[entry.name] = await measureTree(path.join(rootDir, entry.name));
	}
	return { directories, rootDir, total };
}

/** @param {unknown} value @param {string} label */
function parseBudget(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} asset budget`);
	}
	const candidate =
		/** @type {{ maxBytes?: unknown; maxFiles?: unknown; optional?: unknown }} */ (value);
	for (const [key, amount] of [
		['maxBytes', candidate.maxBytes],
		['maxFiles', candidate.maxFiles]
	]) {
		if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
			throw new Error(`invalid ${label}.${key} asset budget`);
		}
	}
	if (candidate.optional !== undefined && typeof candidate.optional !== 'boolean') {
		throw new Error(`invalid ${label}.optional asset budget`);
	}
	return {
		maxBytes: /** @type {number} */ (candidate.maxBytes),
		maxFiles: /** @type {number} */ (candidate.maxFiles),
		optional: candidate.optional === true
	};
}

/** @param {unknown} value */
export function parseStaticAssetBudgets(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('invalid static asset budget root');
	}
	const root =
		/** @type {{ schemaVersion?: unknown; total?: unknown; directories?: unknown }} */ (value);
	if (root.schemaVersion !== 1) throw new Error('unsupported static asset budget schema');
	if (
		!root.directories ||
		typeof root.directories !== 'object' ||
		Array.isArray(root.directories)
	) {
		throw new Error('invalid static asset directory budgets');
	}
	/** @type {Record<string, AssetBudget>} */
	const directories = {};
	for (const [directoryName, budget] of Object.entries(root.directories)) {
		directories[directoryName] = parseBudget(budget, `directories.${directoryName}`);
	}
	return { schemaVersion: 1, total: parseBudget(root.total, 'total'), directories };
}

/**
 * @param {Awaited<ReturnType<typeof measureStaticAssets>>} measurement
 * @param {ReturnType<typeof parseStaticAssetBudgets>} budgets
 */
export function checkStaticAssetBudgets(measurement, budgets) {
	/** @type {string[]} */
	const violations = [];
	/** @param {string} label @param {AssetMeasurement} measured @param {AssetBudget} budget */
	const check = (label, measured, budget) => {
		if (measured.bytes > budget.maxBytes) {
			violations.push(`${label} uses ${measured.bytes} bytes; budget is ${budget.maxBytes}`);
		}
		if (measured.files > budget.maxFiles) {
			violations.push(
				`${label} contains ${measured.files} files; budget is ${budget.maxFiles}`
			);
		}
	};
	check('static', measurement.total, budgets.total);
	for (const [directoryName, measured] of Object.entries(measurement.directories)) {
		if (!isRuntimeAssetDirectory(directoryName)) continue;
		const budget = budgets.directories[directoryName];
		if (!budget) {
			violations.push(`${directoryName} has runtime assets but no directory budget`);
			continue;
		}
		check(directoryName, measured, budget);
	}
	for (const directoryName of Object.keys(budgets.directories)) {
		if (
			!measurement.directories[directoryName] &&
			!budgets.directories[directoryName].optional
		) {
			violations.push(`${directoryName} has an asset budget but no directory`);
		}
	}
	return violations;
}

/** @param {number} bytes */
function formatMiB(bytes) {
	return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** @param {Awaited<ReturnType<typeof measureStaticAssets>>} measurement */
export function formatStaticAssetReport(measurement) {
	const lines = [
		`Static assets: ${formatMiB(measurement.total.bytes)}, ${measurement.total.files.toLocaleString('en-US')} files, ${formatMiB(measurement.total.compressedBytes)} precompressed.`,
		'',
		'Runtime directories:'
	];
	const runtimeEntries = Object.entries(measurement.directories)
		.filter(([directoryName]) => isRuntimeAssetDirectory(directoryName))
		.sort((left, right) => right[1].bytes - left[1].bytes);
	for (const [directoryName, measured] of runtimeEntries) {
		lines.push(
			`  ${directoryName}: ${formatMiB(measured.bytes)}, ${measured.files.toLocaleString('en-US')} files`
		);
	}
	return lines.join('\n');
}

async function main() {
	const mode = process.argv[2] || 'report';
	if (mode !== 'report' && mode !== 'check') {
		throw new Error(`unknown static asset size mode: ${mode}`);
	}
	const measurement = await measureStaticAssets();
	console.log(formatStaticAssetReport(measurement));
	if (mode === 'check') {
		const budgets = parseStaticAssetBudgets(
			JSON.parse(await readFile(DEFAULT_BUDGET_FILE, 'utf8'))
		);
		const violations = checkStaticAssetBudgets(measurement, budgets);
		if (violations.length > 0) {
			throw new Error(
				`Static asset budget exceeded:\n${violations.map((item) => `- ${item}`).join('\n')}`
			);
		}
		console.log('\nStatic asset budgets passed.');
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	await main();
}
