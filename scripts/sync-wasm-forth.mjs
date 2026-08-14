import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const require = createRequire(import.meta.url);
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-forth');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-forth-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmForthVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-forth-assets.lock.json');
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const RUNTIME_FILES = /** @type {const} */ (['runner-worker.js', MANIFEST_FILE, 'waforth.js']);
export const FORTH_MANIFEST_FORMAT = 'wasm-forth-runtime-manifest-v2';
const FORTH_PUBLICATION_JOURNAL_FORMAT = 'wasm-forth-publication-journal-v1';
const FORTH_PUBLICATION_COMMIT_FORMAT = 'wasm-forth-publication-commit-v1';
const FINGERPRINT_DOMAIN = 'wasm-idle:forth-runtime-manifest:v2';
const PUBLICATION_JOURNAL_SUFFIX = '.publication-journal.v1.json';

/** @typedef {{ bytes: number; sha256: string }} ForthAssetReceipt */
/** @typedef {{ path: string; size: number; sha256: string }} ForthManifestReceipt */
/** @typedef {{ fingerprint: string; runtimeFiles: readonly { path: string; bytes: number; sha256: string }[]; versionModule: ForthAssetReceipt }} PublicationExpected */
/** @typedef {{ schemaVersion: 1; profileId: string; upstream: { packageName: 'waforth'; packageVersion: string; assetPath: 'dist/index.js'; bytes: number; sha256: string } }} ForthInputLock */

/**
 * @typedef {object} SyncWasmForthOptions
 * @property {string} [sourceFile]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 * @property {(ticketPath: string) => Promise<void>} [onPublicationTicketCreated]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {string} filePath */
async function pathExists(filePath) {
	return !!(await lstatOrNull(filePath));
}

/** @param {string} filePath */
async function lstatOrNull(filePath) {
	try {
		return await lstat(filePath);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
		if (code === 'ENOENT') return null;
		throw error;
	}
}

/** @param {string} filePath */
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

/** @param {string} parent @param {string} candidate */
function containsPath(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

/** @param {string} left @param {string} right */
const pathsOverlap = (left, right) => containsPath(left, right) || containsPath(right, left);

/** @param {string} filePath */
async function resolveBoundaryPath(filePath) {
	let cursor = path.resolve(filePath);
	/** @type {string[]} */
	const unresolved = [];
	for (;;) {
		try {
			return path.join(await realpath(cursor), ...unresolved.reverse());
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			if (code !== 'ENOENT') throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) return path.resolve(filePath);
			unresolved.push(path.basename(cursor));
			cursor = parent;
		}
	}
}

/** @param {string} filePath @param {string} label */
async function readJson(filePath, label) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** @param {unknown} value @param {string} label */
function validateReceipt(value, label) {
	if (
		!isObject(value) ||
		typeof value.bytes !== 'number' ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid size or SHA-256 metadata`);
	}
	return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-forth input lock must be a regular file: ${lockFilePath}`);
	}
	const value = await readJson(lockFilePath, 'wasm-forth input lock');
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^waforth-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!isObject(value.upstream) ||
		value.upstream.packageName !== 'waforth' ||
		typeof value.upstream.packageVersion !== 'string' ||
		!/^[A-Za-z0-9._-]+$/u.test(value.upstream.packageVersion) ||
		value.upstream.assetPath !== 'dist/index.js'
	) {
		throw new Error('wasm-forth input lock has invalid upstream metadata');
	}
	if (value.profileId !== `waforth-${value.upstream.packageVersion}`) {
		throw new Error('wasm-forth input lock profile does not match the package version');
	}
	const receipt = validateReceipt(value.upstream, 'wasm-forth upstream asset');
	return Object.freeze({
		schemaVersion: /** @type {const} */ (1),
		profileId: value.profileId,
		upstream: Object.freeze({
			packageName: /** @type {const} */ ('waforth'),
			packageVersion: value.upstream.packageVersion,
			assetPath: /** @type {const} */ ('dist/index.js'),
			...receipt
		})
	});
}

function resolveDefaultSourceFile() {
	const packageJsonPath = require.resolve('waforth/package.json');
	return path.join(path.dirname(packageJsonPath), 'dist', 'index.js');
}

/** @param {string} source */
function wrapWaforthBundle(source) {
	const normalized = source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n');
	return [
		'var module = { exports: {} };',
		'var exports = module.exports;',
		normalized,
		'self.WAForthPackage = module.exports;',
		''
	].join('\n');
}

/** @param {ForthInputLock} lock @param {readonly ForthManifestReceipt[]} assets */
function computeFingerprint(lock, assets) {
	const hash = createHash('sha256');
	hash.update(`${FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${FORTH_MANIFEST_FORMAT}\n`);
	hash.update(`profileId\0${lock.profileId}\n`);
	hash.update(`waforthVersion\0${lock.upstream.packageVersion}\n`);
	for (const receipt of assets) {
		hash.update(receipt.path);
		hash.update('\0');
		hash.update(String(receipt.size));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex');
}

/** @param {ForthInputLock} lock @param {readonly ForthManifestReceipt[]} assets */
function renderManifest(lock, assets) {
	return `${JSON.stringify(
		{
			format: FORTH_MANIFEST_FORMAT,
			runtime: 'waforth',
			profileId: lock.profileId,
			waforthVersion: lock.upstream.packageVersion,
			fingerprint: computeFingerprint(lock, assets),
			assets
		},
		null,
		'\t'
	)}\n`;
}

/** @param {string} fingerprint @param {Readonly<ForthAssetReceipt>} workerReceipt */
function renderVersionModule(fingerprint, workerReceipt) {
	return `export const WASM_FORTH_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_FORTH_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
}

/** @param {Uint8Array} bytes @param {Readonly<ForthAssetReceipt>} receipt @param {string} label */
function verifyBytes(bytes, receipt, label) {
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`${label} does not match its pinned receipt`);
	}
}

/**
 * @param {string} targetDir
 * @param {string} manifestSource
 * @param {Readonly<ForthAssetReceipt>} waforthReceipt
 * @param {Readonly<ForthAssetReceipt>} workerReceipt
 */
async function validateInstalledSnapshot(targetDir, manifestSource, waforthReceipt, workerReceipt) {
	const entries = (await readdir(targetDir)).sort();
	const expected = [...RUNTIME_FILES].sort();
	if (
		entries.length !== expected.length ||
		entries.some((entry, index) => entry !== expected[index])
	) {
		throw new Error('wasm-forth installed runtime has an unexpected asset set');
	}
	verifyBytes(
		await readFile(path.join(targetDir, 'waforth.js')),
		waforthReceipt,
		'installed waforth.js'
	);
	verifyBytes(
		await readFile(path.join(targetDir, 'runner-worker.js')),
		workerReceipt,
		'installed runner-worker.js'
	);
	if ((await readFile(path.join(targetDir, MANIFEST_FILE), 'utf8')) !== manifestSource) {
		throw new Error('wasm-forth installed runtime manifest drifted');
	}
}

/**
 * @param {string} targetDir
 * @param {string} versionModulePath
 * @param {PublicationExpected} expected
 */
async function verifyPublicationSnapshot(targetDir, versionModulePath, expected) {
	const entries = (await readdir(targetDir)).sort();
	const expectedPaths = expected.runtimeFiles.map(({ path: assetPath }) => assetPath).sort();
	if (
		entries.length !== expectedPaths.length ||
		entries.some((entry, index) => entry !== expectedPaths[index])
	) {
		throw new Error('wasm-forth committed runtime has an unexpected asset set');
	}
	for (const receipt of expected.runtimeFiles) {
		const assetPath = path.join(targetDir, receipt.path);
		const stats = await lstatOrNull(assetPath);
		if (!stats?.isFile()) {
			throw new Error('wasm-forth committed runtime contains an unsafe asset type');
		}
		verifyBytes(await readFile(assetPath), receipt, `committed ${receipt.path}`);
	}
	const versionStats = await lstatOrNull(versionModulePath);
	if (!versionStats?.isFile()) {
		throw new Error('wasm-forth committed version module has an unsafe type');
	}
	verifyBytes(
		await readFile(versionModulePath),
		expected.versionModule,
		'committed version module'
	);
}

/**
 * @typedef {{ current: string; next: string; previous: string; hadCurrent: boolean; kind: 'directory' | 'file' }} PublicationSwap
 */

/**
 * @param {readonly PublicationSwap[]} swaps
 * @param {(sourcePath: string, targetPath: string) => Promise<void>} renamePath
 */
async function rollbackSwaps(swaps, renamePath) {
	for (const swap of [...swaps].reverse()) {
		const [currentStats, previousStats] = await Promise.all([
			lstatOrNull(swap.current),
			lstatOrNull(swap.previous)
		]);
		const currentMatchesKind =
			!currentStats ||
			(swap.kind === 'directory' ? currentStats.isDirectory() : currentStats.isFile());
		const previousMatchesKind =
			!previousStats ||
			(swap.kind === 'directory' ? previousStats.isDirectory() : previousStats.isFile());
		if (!currentMatchesKind) {
			throw new Error('wasm-forth publication journal current output has an unsafe type');
		}
		if (!previousMatchesKind) {
			throw new Error('wasm-forth publication journal previous output has an unsafe type');
		}
		if (swap.hadCurrent) {
			if (previousStats) {
				await rm(swap.current, { recursive: true, force: true });
				await renamePath(swap.previous, swap.current);
			} else if (!currentStats) {
				throw new Error('wasm-forth publication journal cannot restore a missing output');
			}
		} else {
			if (previousStats) {
				throw new Error('wasm-forth publication journal contains an unexpected backup');
			}
			await rm(swap.current, { recursive: true, force: true });
		}
		await rm(swap.next, { recursive: true, force: true });
	}
}

/** @param {readonly PublicationSwap[]} swaps @param {PublicationExpected} expected */
async function finalizeSwaps(swaps, expected) {
	await verifyPublicationSnapshot(swaps[0].current, swaps[1].current, expected);
	for (const swap of swaps) {
		const stats = await lstatOrNull(swap.current);
		const matchesKind =
			stats && (swap.kind === 'directory' ? stats.isDirectory() : stats.isFile());
		if (!matchesKind) {
			throw new Error('wasm-forth committed publication is missing a valid output');
		}
	}
	for (const swap of swaps) {
		await rm(swap.next, { recursive: true, force: true });
		await rm(swap.previous, { recursive: true, force: true });
	}
}

/**
 * @param {readonly PublicationSwap[]} swaps
 * @param {(sourcePath: string, targetPath: string) => Promise<void>} renamePath
 * @param {{ journalPath: string; commitPath: string; markerStagingPath: string; markerSource: string; expected: PublicationExpected }} journal
 */
async function publishSwaps(swaps, renamePath, journal) {
	try {
		for (const swap of swaps) {
			if (swap.hadCurrent) await renamePath(swap.current, swap.previous);
			await renamePath(swap.next, swap.current);
		}
		await verifyPublicationSnapshot(swaps[0].current, swaps[1].current, journal.expected);
		await writeFile(journal.markerStagingPath, journal.markerSource, {
			encoding: 'utf8',
			flag: 'wx'
		});
		await rename(journal.markerStagingPath, journal.commitPath);
		await finalizeSwaps(swaps, journal.expected);
		await rm(journal.journalPath, { force: true });
		await rm(journal.commitPath, { force: true });
	} catch (error) {
		let committed = false;
		try {
			const markerStats = await lstatOrNull(journal.commitPath);
			if (markerStats && !markerStats.isFile()) {
				throw new Error('wasm-forth publication commit marker has an unsafe type');
			}
			if (markerStats) {
				committed = (await readFile(journal.commitPath, 'utf8')) === journal.markerSource;
				if (!committed) await rm(journal.commitPath, { force: true });
			}
		} catch (markerError) {
			throw new AggregateError(
				[error, markerError],
				'wasm-forth publication failed and commit state could not be determined'
			);
		}
		if (committed) throw error;
		try {
			await rollbackSwaps(swaps, renamePath);
			await rm(journal.journalPath, { force: true });
			await rm(journal.commitPath, { force: true });
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				'wasm-forth publication failed and rollback was incomplete'
			);
		}
		throw error;
	}
}

/** @param {SyncWasmForthOptions} [options] */
export async function syncWasmForthAssets(options = {}) {
	if (!isMainThread) {
		throw new Error('wasm-forth asset synchronization requires the main Node thread');
	}
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const configuredSourceFile = options.sourceFile ? path.resolve(options.sourceFile) : null;
	let discoveredDefaultSourceFile = null;
	if (!configuredSourceFile) {
		try {
			discoveredDefaultSourceFile = path.resolve(resolveDefaultSourceFile());
		} catch {
			// Default discovery is retried after journal recovery so a missing package cannot gate it.
		}
	}
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const configuredInputPaths = [
		configuredSourceFile || discoveredDefaultSourceFile,
		workerSourcePath,
		lockFilePath
	].filter(
		/** @returns {value is string} */
		(value) => value !== null
	);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const renamePath = options.renamePath || rename;
	const journalPath = `${targetDir}${PUBLICATION_JOURNAL_SUFFIX}`;
	const commitPath = `${journalPath}.committed`;
	const lockToken = randomUUID();
	const publicationLockDir = path.dirname(journalPath);
	const publicationLockPrefix = `${path.basename(journalPath)}.lock-`;
	const publicationLockPath = path.join(
		publicationLockDir,
		`${publicationLockPrefix}${process.pid}-${lockToken}`
	);

	const [
		targetBoundary,
		versionBoundary,
		journalBoundary,
		commitBoundary,
		publicationLockBoundary
	] = await Promise.all(
		[targetDir, versionModulePath, journalPath, commitPath, publicationLockPath].map(
			resolveBoundaryPath
		)
	);
	for (const [left, right, message] of [
		[targetBoundary, versionBoundary, 'version module must be outside the runtime target'],
		[targetBoundary, journalBoundary, 'publication journal must be outside the runtime target'],
		[targetBoundary, commitBoundary, 'commit marker must be outside the runtime target'],
		[
			versionBoundary,
			journalBoundary,
			'version module and publication journal must not overlap'
		],
		[versionBoundary, commitBoundary, 'version module and commit marker must not overlap'],
		[
			targetBoundary,
			publicationLockBoundary,
			'publication lock must be outside the runtime target'
		],
		[
			versionBoundary,
			publicationLockBoundary,
			'version module and publication lock must not overlap'
		]
	]) {
		if (pathsOverlap(left, right)) throw new Error(`wasm-forth ${message}`);
	}
	await mkdir(path.dirname(targetDir), { recursive: true });
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	let publicationLockCreated = false;
	let operationError;
	let operationResult;
	try {
		// The unique, empty ticket name is the complete claim. Its wx creation is atomic,
		// so peers never need to interpret partially written ownership metadata.
		await writeFile(publicationLockPath, '', { flag: 'wx' });
		publicationLockCreated = true;
		const protectedInputPaths = new Set(configuredInputPaths);
		for (const inputPath of configuredInputPaths) {
			try {
				protectedInputPaths.add(await resolveBoundaryPath(inputPath));
			} catch (error) {
				const code =
					error && typeof error === 'object' && 'code' in error ? error.code : undefined;
				if (code === 'ENOENT' || code === 'ELOOP') continue;
				throw error;
			}
		}
		await options.onPublicationTicketCreated?.(publicationLockPath);
		// Ticket enumeration assumes one coherent local filesystem and one host PID namespace.
		// Contenders never preempt a live ticket; simultaneous contenders may both back off.
		let ownLockSeen = false;
		/** @type {number | null} */
		let activeOwnerPid = null;
		/** @type {string | null} */
		let activeOwnerTicket = null;
		for (const entryName of await readdir(publicationLockDir)) {
			if (!entryName.startsWith(publicationLockPrefix)) continue;
			const identity = entryName
				.slice(publicationLockPrefix.length)
				.match(
					/^([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
				);
			if (!identity) {
				throw new Error('wasm-forth publication lock has an invalid ticket name');
			}
			const candidatePath = path.join(publicationLockDir, entryName);
			let candidateStats;
			try {
				candidateStats = await lstat(candidatePath);
			} catch (error) {
				const code =
					error && typeof error === 'object' && 'code' in error ? error.code : undefined;
				if (code === 'ENOENT') continue;
				throw error;
			}
			if (!candidateStats.isFile()) {
				throw new Error('wasm-forth publication lock has an unsafe type');
			}
			const candidatePid = Number(identity[1]);
			if (!Number.isSafeInteger(candidatePid)) {
				throw new Error('wasm-forth publication lock has an invalid process id');
			}
			let ownerIsAlive = false;
			try {
				process.kill(candidatePid, 0);
				ownerIsAlive = true;
			} catch (ownerError) {
				const ownerCode =
					ownerError && typeof ownerError === 'object' && 'code' in ownerError
						? ownerError.code
						: undefined;
				if (ownerCode === 'ESRCH') {
					ownerIsAlive = false;
				} else if (ownerCode === 'EPERM') {
					ownerIsAlive = true;
				} else {
					throw ownerError;
				}
			}
			if (!ownerIsAlive) {
				const candidateBoundary = await resolveBoundaryPath(candidatePath);
				if (
					[...protectedInputPaths].some(
						(inputPath) =>
							pathsOverlap(inputPath, candidatePath) ||
							pathsOverlap(inputPath, candidateBoundary)
					)
				) {
					throw new Error(
						'wasm-forth configured input overlaps a stale publication lock'
					);
				}
				await rm(candidatePath, { force: true });
				continue;
			}
			if (candidatePath === publicationLockPath) {
				ownLockSeen = true;
			} else {
				activeOwnerPid ??= candidatePid;
				activeOwnerTicket ??= entryName;
			}
		}
		if (!ownLockSeen) {
			throw new Error('wasm-forth publication lock ownership was lost');
		}
		if (activeOwnerPid !== null) {
			throw new Error(
				`wasm-forth publication is already active in process ${activeOwnerPid}; if that PID was reused, remove stale ticket ${activeOwnerTicket} only after confirming no producer is active`
			);
		}
		const transactionSuffixPattern =
			/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
		const journalStats = await lstatOrNull(journalPath);
		if (journalStats && !journalStats.isFile()) {
			throw new Error('wasm-forth publication journal must be a regular file');
		}
		const commitStats = await lstatOrNull(commitPath);
		if (commitStats && !commitStats.isFile()) {
			throw new Error('wasm-forth publication commit marker must be a regular file');
		}
		if (journalStats) {
			const journalSource = await readFile(journalPath, 'utf8');
			let value;
			try {
				value = JSON.parse(journalSource);
			} catch (error) {
				throw new Error(
					`wasm-forth publication journal is not valid JSON: ${error instanceof Error ? error.message : error}`
				);
			}
			if (
				!isObject(value) ||
				value.format !== FORTH_PUBLICATION_JOURNAL_FORMAT ||
				typeof value.transactionId !== 'string' ||
				!/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
					value.transactionId
				) ||
				value.targetDir !== targetDir ||
				value.versionModulePath !== versionModulePath ||
				!isObject(value.hadCurrent) ||
				typeof value.hadCurrent.runtime !== 'boolean' ||
				typeof value.hadCurrent.versionModule !== 'boolean' ||
				!isObject(value.expected) ||
				typeof value.expected.fingerprint !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(value.expected.fingerprint) ||
				!Array.isArray(value.expected.runtimeFiles) ||
				!isObject(value.expected.versionModule)
			) {
				throw new Error('wasm-forth publication journal is invalid');
			}
			const runtimeFiles = value.expected.runtimeFiles.map((candidate, index) => {
				if (!isObject(candidate) || typeof candidate.path !== 'string') {
					throw new Error(
						'wasm-forth publication journal has an invalid runtime receipt'
					);
				}
				return Object.freeze({
					path: candidate.path,
					...validateReceipt(candidate, `wasm-forth publication runtime receipt ${index}`)
				});
			});
			const expectedPaths = runtimeFiles.map(({ path: assetPath }) => assetPath).sort();
			const requiredPaths = [...RUNTIME_FILES].sort();
			if (
				expectedPaths.length !== requiredPaths.length ||
				expectedPaths.some((assetPath, index) => assetPath !== requiredPaths[index])
			) {
				throw new Error('wasm-forth publication journal has an invalid runtime asset set');
			}
			const expected = Object.freeze({
				fingerprint: value.expected.fingerprint,
				runtimeFiles: Object.freeze(runtimeFiles),
				versionModule: validateReceipt(
					value.expected.versionModule,
					'wasm-forth publication version receipt'
				)
			});
			const recoveredSwaps = [
				{
					current: targetDir,
					next: `${targetDir}.next-${value.transactionId}`,
					previous: `${targetDir}.previous-${value.transactionId}`,
					hadCurrent: value.hadCurrent.runtime,
					kind: /** @type {const} */ ('directory')
				},
				{
					current: versionModulePath,
					next: `${versionModulePath}.next-${value.transactionId}`,
					previous: `${versionModulePath}.previous-${value.transactionId}`,
					hadCurrent: value.hadCurrent.versionModule,
					kind: /** @type {const} */ ('file')
				}
			];
			const recoveryPaths = [
				journalPath,
				commitPath,
				`${journalPath}.next-${value.transactionId}`,
				`${commitPath}.next-${value.transactionId}`,
				...recoveredSwaps.flatMap(({ current, next, previous }) => [
					current,
					next,
					previous
				])
			];
			const protectedRecoveryPaths = new Set(recoveryPaths);
			for (const recoveryPath of recoveryPaths) {
				protectedRecoveryPaths.add(await resolveBoundaryPath(recoveryPath));
			}
			for (const inputPath of protectedInputPaths) {
				if (
					[...protectedRecoveryPaths].some((recoveryPath) =>
						pathsOverlap(inputPath, recoveryPath)
					)
				) {
					throw new Error(
						'wasm-forth configured input overlaps publication recovery state'
					);
				}
			}
			const markerSource = `${JSON.stringify({
				format: FORTH_PUBLICATION_COMMIT_FORMAT,
				transactionId: value.transactionId,
				journalSha256: sha256(Buffer.from(journalSource, 'utf8'))
			})}\n`;
			if (commitStats && (await readFile(commitPath, 'utf8')) === markerSource) {
				await finalizeSwaps(recoveredSwaps, expected);
			} else {
				await rm(commitPath, { force: true });
				await rollbackSwaps(recoveredSwaps, renamePath);
			}
			await Promise.all([
				rm(`${journalPath}.next-${value.transactionId}`, { force: true }),
				rm(`${commitPath}.next-${value.transactionId}`, { force: true })
			]);
			await rm(journalPath, { force: true });
			await rm(commitPath, { force: true });
		} else {
			if (
				commitStats &&
				[...protectedInputPaths].some(
					(inputPath) =>
						pathsOverlap(inputPath, commitPath) ||
						pathsOverlap(inputPath, commitBoundary)
				)
			) {
				throw new Error(
					'wasm-forth configured input overlaps an orphan publication commit marker'
				);
			}
			await rm(commitPath, { force: true });
		}

		// Input discovery and realpath validation are intentionally after journal recovery.
		// A missing package or broken source path must not strand a mixed output generation.
		const sourceFile =
			configuredSourceFile ||
			discoveredDefaultSourceFile ||
			path.resolve(resolveDefaultSourceFile());
		const [sourceBoundary, workerBoundary, lockBoundary] = await Promise.all(
			[sourceFile, workerSourcePath, lockFilePath].map(resolveBoundaryPath)
		);
		for (const [left, right, message] of [
			[sourceBoundary, workerBoundary, 'source bundle and worker source must not overlap'],
			[sourceBoundary, targetBoundary, 'source bundle and runtime target must not overlap'],
			[sourceBoundary, versionBoundary, 'source bundle and version module must not overlap'],
			[
				sourceBoundary,
				journalBoundary,
				'source bundle and publication journal must not overlap'
			],
			[sourceBoundary, commitBoundary, 'source bundle and commit marker must not overlap'],
			[workerBoundary, targetBoundary, 'worker source and runtime target must not overlap'],
			[workerBoundary, versionBoundary, 'worker source and version module must not overlap'],
			[
				workerBoundary,
				journalBoundary,
				'worker source and publication journal must not overlap'
			],
			[workerBoundary, commitBoundary, 'worker source and commit marker must not overlap'],
			[targetBoundary, lockBoundary, 'input lock must be outside the runtime target'],
			[versionBoundary, lockBoundary, 'input lock and version module must not overlap'],
			[lockBoundary, journalBoundary, 'input lock and publication journal must not overlap'],
			[lockBoundary, commitBoundary, 'input lock and commit marker must not overlap'],
			[
				sourceBoundary,
				publicationLockBoundary,
				'source bundle and publication lock must not overlap'
			],
			[
				workerBoundary,
				publicationLockBoundary,
				'worker source and publication lock must not overlap'
			],
			[
				lockBoundary,
				publicationLockBoundary,
				'input lock and publication lock must not overlap'
			]
		]) {
			if (pathsOverlap(left, right)) throw new Error(`wasm-forth ${message}`);
		}
		const inputBoundaries = [sourceBoundary, workerBoundary, lockBoundary];
		for (const [stagingParent, stagingPrefix, stagingKind] of [
			[
				publicationLockDir,
				`${path.basename(journalPath)}.next-`,
				/** @type {const} */ ('file')
			],
			[
				publicationLockDir,
				`${path.basename(commitPath)}.next-`,
				/** @type {const} */ ('file')
			],
			[
				path.dirname(targetDir),
				`${path.basename(targetDir)}.next-`,
				/** @type {const} */ ('directory')
			],
			[
				path.dirname(versionModulePath),
				`${path.basename(versionModulePath)}.next-`,
				/** @type {const} */ ('file')
			]
		]) {
			for (const entryName of await readdir(stagingParent)) {
				if (
					!entryName.startsWith(stagingPrefix) ||
					!transactionSuffixPattern.test(entryName.slice(stagingPrefix.length))
				) {
					continue;
				}
				const stagingPath = path.join(stagingParent, entryName);
				const stagingStats = await lstatOrNull(stagingPath);
				if (!stagingStats) continue;
				const matchesKind =
					stagingKind === 'directory'
						? stagingStats.isDirectory()
						: stagingStats.isFile();
				if (!matchesKind) {
					throw new Error('wasm-forth publication staging has an unsafe type');
				}
				const stagingBoundary = await resolveBoundaryPath(stagingPath);
				if (
					inputBoundaries.some((inputBoundary) =>
						pathsOverlap(inputBoundary, stagingBoundary)
					)
				) {
					throw new Error('wasm-forth configured input overlaps publication staging');
				}
				await rm(stagingPath, {
					recursive: stagingKind === 'directory',
					force: true
				});
			}
		}
		if (!(await isRegularFile(sourceFile))) {
			throw new Error(`waforth bundle must be a regular file: ${sourceFile}`);
		}
		if (!(await isRegularFile(workerSourcePath))) {
			throw new Error(`wasm-forth worker source must be a regular file: ${workerSourcePath}`);
		}
		const [targetStats, versionStats] = await Promise.all([
			lstatOrNull(targetDir),
			lstatOrNull(versionModulePath)
		]);
		if (targetStats && !targetStats.isDirectory()) {
			throw new Error(`wasm-forth runtime target must be a directory: ${targetDir}`);
		}
		if (versionStats && !versionStats.isFile()) {
			throw new Error(
				`wasm-forth version module must be a regular file: ${versionModulePath}`
			);
		}

		const lock = await readInputLock(lockFilePath);
		const sourceBytes = await readFile(sourceFile);
		verifyBytes(sourceBytes, lock.upstream, 'waforth source bundle');
		let bundleSource;
		try {
			bundleSource = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
		} catch {
			throw new Error('waforth source bundle is not valid UTF-8');
		}
		if (
			!bundleSource.includes('module.exports') ||
			!bundleSource.includes('WebAssembly.instantiate')
		) {
			throw new Error('waforth bundle does not look like the expected WebAssembly runtime');
		}
		const workerBytes = await readFile(workerSourcePath);
		let workerSource;
		try {
			workerSource = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
			new Function(workerSource);
		} catch {
			throw new Error('wasm-forth worker source is not valid JavaScript');
		}
		if (
			!workerSource.includes('self.onmessage') ||
			!workerSource.includes(FORTH_MANIFEST_FORMAT)
		) {
			throw new Error(
				'wasm-forth worker source does not implement the pinned runtime protocol'
			);
		}

		const waforthBytes = Buffer.from(wrapWaforthBundle(bundleSource), 'utf8');
		const waforthReceipt = Object.freeze({
			bytes: waforthBytes.byteLength,
			sha256: sha256(waforthBytes)
		});
		const workerReceipt = Object.freeze({
			bytes: workerBytes.byteLength,
			sha256: sha256(workerBytes)
		});
		const assets = Object.freeze([
			Object.freeze({
				path: 'waforth.js',
				size: waforthReceipt.bytes,
				sha256: waforthReceipt.sha256
			})
		]);
		const fingerprint = computeFingerprint(lock, assets);
		const manifestSource = renderManifest(lock, assets);
		const versionSource = renderVersionModule(fingerprint, workerReceipt);
		const manifestBytes = Buffer.from(manifestSource, 'utf8');
		const versionBytes = Buffer.from(versionSource, 'utf8');
		const expectedPublication = Object.freeze({
			fingerprint,
			runtimeFiles: Object.freeze([
				Object.freeze({ path: 'runner-worker.js', ...workerReceipt }),
				Object.freeze({
					path: MANIFEST_FILE,
					bytes: manifestBytes.byteLength,
					sha256: sha256(manifestBytes)
				}),
				Object.freeze({ path: 'waforth.js', ...waforthReceipt })
			]),
			versionModule: Object.freeze({
				bytes: versionBytes.byteLength,
				sha256: sha256(versionBytes)
			})
		});

		const suffix = `${process.pid}-${randomUUID()}`;
		const nextTargetDir = `${targetDir}.next-${suffix}`;
		const previousTargetDir = `${targetDir}.previous-${suffix}`;
		const nextVersionModulePath = `${versionModulePath}.next-${suffix}`;
		const previousVersionModulePath = `${versionModulePath}.previous-${suffix}`;
		const journalStagingPath = `${journalPath}.next-${suffix}`;
		const markerStagingPath = `${commitPath}.next-${suffix}`;
		await mkdir(path.dirname(targetDir), { recursive: true });
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await rm(nextTargetDir, { recursive: true, force: true });
		await rm(nextVersionModulePath, { force: true });

		let publicationError;
		try {
			await mkdir(nextTargetDir, { recursive: true });
			await writeFile(path.join(nextTargetDir, 'waforth.js'), waforthBytes);
			await writeFile(path.join(nextTargetDir, 'runner-worker.js'), workerBytes);
			await writeFile(path.join(nextTargetDir, MANIFEST_FILE), manifestSource, 'utf8');
			await validateInstalledSnapshot(
				nextTargetDir,
				manifestSource,
				waforthReceipt,
				workerReceipt
			);
			await writeFile(nextVersionModulePath, versionBytes);
			const swaps = [
				{
					current: targetDir,
					next: nextTargetDir,
					previous: previousTargetDir,
					hadCurrent: await pathExists(targetDir),
					kind: /** @type {const} */ ('directory')
				},
				{
					current: versionModulePath,
					next: nextVersionModulePath,
					previous: previousVersionModulePath,
					hadCurrent: await pathExists(versionModulePath),
					kind: /** @type {const} */ ('file')
				}
			];
			const journalSource = `${JSON.stringify({
				format: FORTH_PUBLICATION_JOURNAL_FORMAT,
				transactionId: suffix,
				targetDir,
				versionModulePath,
				hadCurrent: {
					runtime: swaps[0].hadCurrent,
					versionModule: swaps[1].hadCurrent
				},
				expected: expectedPublication
			})}\n`;
			const markerSource = `${JSON.stringify({
				format: FORTH_PUBLICATION_COMMIT_FORMAT,
				transactionId: suffix,
				journalSha256: sha256(Buffer.from(journalSource, 'utf8'))
			})}\n`;
			// Closed staging writes plus same-directory renames make the state files whole across a
			// producer process exit. Power-loss durability remains the filesystem's responsibility.
			await writeFile(journalStagingPath, journalSource, { encoding: 'utf8', flag: 'wx' });
			await rename(journalStagingPath, journalPath);
			await publishSwaps(swaps, renamePath, {
				journalPath,
				commitPath,
				markerStagingPath,
				markerSource,
				expected: expectedPublication
			});
		} catch (error) {
			publicationError = error;
		}
		const publicationCleanupResults = await Promise.allSettled([
			rm(nextTargetDir, { recursive: true, force: true }),
			rm(nextVersionModulePath, { force: true }),
			rm(journalStagingPath, { force: true }),
			rm(markerStagingPath, { force: true })
		]);
		const publicationCleanupErrors = publicationCleanupResults.flatMap((result) =>
			result.status === 'rejected' ? [result.reason] : []
		);
		if (publicationCleanupErrors.length > 0) {
			throw new AggregateError(
				publicationError
					? [publicationError, ...publicationCleanupErrors]
					: publicationCleanupErrors,
				publicationError
					? 'wasm-forth publication failed and staging cleanup was incomplete'
					: 'wasm-forth publication staging cleanup was incomplete'
			);
		}
		if (publicationError) throw publicationError;

		operationResult = {
			sourceFile,
			targetDir,
			fingerprint,
			profileId: lock.profileId,
			assets,
			workerReceipt,
			versionModulePath
		};
	} catch (error) {
		operationError = error;
	}
	const cleanupErrors = [];
	if (publicationLockCreated) {
		try {
			const activeLockStats = await lstatOrNull(publicationLockPath);
			if (!activeLockStats) {
				throw new Error('wasm-forth publication lock ownership was lost');
			}
			if (!activeLockStats.isFile()) {
				throw new Error('wasm-forth publication lock has an unsafe type');
			}
			await rm(publicationLockPath, { force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(
			operationError ? [operationError, ...cleanupErrors] : cleanupErrors,
			operationError
				? 'wasm-forth synchronization failed and publication lock cleanup was incomplete'
				: 'wasm-forth publication lock cleanup was incomplete'
		);
	}
	if (operationError) throw operationError;
	if (!operationResult) throw new Error('wasm-forth synchronization produced no result');
	return operationResult;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceFileArg, targetDirArg] = process.argv;
	const { sourceFile, targetDir } = await syncWasmForthAssets({
		...(sourceFileArg ? { sourceFile: sourceFileArg } : {}),
		...(targetDirArg ? { targetDir: targetDirArg } : {})
	});
	console.log(`Synced wasm-forth from ${sourceFile} to ${targetDir}`);
}
