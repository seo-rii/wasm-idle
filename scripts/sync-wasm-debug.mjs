import { createHash, randomUUID } from 'node:crypto';
import {
	cp,
	link,
	lstat,
	mkdir,
	open,
	opendir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises';
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
const MAX_INSTALLED_RUNTIME_ENTRIES = 128;
const MAX_INSTALLED_RUNTIME_BYTES = 64 * 1024 * 1024;
const MAX_INSTALLED_RUNTIME_DEPTH = 16;
const MAX_INSTALLED_RUNTIME_PATH_BYTES = 4096;
const publicationQueues = new Map();

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

async function snapshotInstalledRuntime(rootDir) {
	const rootMetadata = await lstat(rootDir);
	if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw new Error('installed wasm debug runtime must be a real directory');
	}
	const pending = [{ absolutePath: rootDir, relativePath: '' }];
	const entries = [];
	let entryCount = 0;
	let totalBytes = 0;
	while (pending.length > 0) {
		const directory = pending.pop();
		const handle = await opendir(directory.absolutePath);
		for await (const child of handle) {
			entryCount += 1;
			if (entryCount > MAX_INSTALLED_RUNTIME_ENTRIES) {
				throw new Error('installed wasm debug runtime exceeds its entry-count budget');
			}
			const absolutePath = path.join(directory.absolutePath, child.name);
			const relativePath = path
				.join(directory.relativePath, child.name)
				.split(path.sep)
				.join('/');
			if (
				relativePath.split('/').length > MAX_INSTALLED_RUNTIME_DEPTH ||
				Buffer.byteLength(relativePath) > MAX_INSTALLED_RUNTIME_PATH_BYTES
			) {
				throw new Error(
					`installed wasm debug runtime path exceeds its budget: ${relativePath}`
				);
			}
			const metadata = await lstat(absolutePath);
			if (metadata.isSymbolicLink()) {
				throw new Error(`installed wasm debug runtime contains a symlink: ${relativePath}`);
			}
			if (metadata.isDirectory()) {
				entries.push({ path: relativePath, type: 'directory' });
				pending.push({ absolutePath, relativePath });
				continue;
			}
			if (!metadata.isFile()) {
				throw new Error(
					`installed wasm debug runtime contains a non-regular entry: ${relativePath}`
				);
			}
			const fileHandle = await open(absolutePath, 'r');
			let bytes;
			try {
				const openedMetadata = await fileHandle.stat();
				if (
					!openedMetadata.isFile() ||
					openedMetadata.dev !== metadata.dev ||
					openedMetadata.ino !== metadata.ino ||
					openedMetadata.size !== metadata.size ||
					openedMetadata.mtimeMs !== metadata.mtimeMs
				) {
					throw new Error(
						`installed wasm debug runtime changed while being opened: ${relativePath}`
					);
				}
				totalBytes += openedMetadata.size;
				if (totalBytes > MAX_INSTALLED_RUNTIME_BYTES) {
					throw new Error('installed wasm debug runtime exceeds its byte budget');
				}
				bytes = Buffer.alloc(openedMetadata.size);
				let offset = 0;
				while (offset < bytes.byteLength) {
					const { bytesRead } = await fileHandle.read(
						bytes,
						offset,
						bytes.byteLength - offset,
						offset
					);
					if (bytesRead === 0) {
						throw new Error(
							`installed wasm debug runtime changed while being read: ${relativePath}`
						);
					}
					offset += bytesRead;
				}
				const [finalOpenedMetadata, finalPathMetadata] = await Promise.all([
					fileHandle.stat(),
					lstat(absolutePath)
				]);
				if (
					finalOpenedMetadata.dev !== openedMetadata.dev ||
					finalOpenedMetadata.ino !== openedMetadata.ino ||
					finalOpenedMetadata.size !== openedMetadata.size ||
					finalOpenedMetadata.mtimeMs !== openedMetadata.mtimeMs ||
					finalPathMetadata.isSymbolicLink() ||
					finalPathMetadata.dev !== openedMetadata.dev ||
					finalPathMetadata.ino !== openedMetadata.ino ||
					finalPathMetadata.size !== openedMetadata.size ||
					finalPathMetadata.mtimeMs !== openedMetadata.mtimeMs
				) {
					throw new Error(
						`installed wasm debug runtime changed while being inspected: ${relativePath}`
					);
				}
			} finally {
				await fileHandle.close();
			}
			entries.push({
				bytes: bytes.byteLength,
				path: relativePath,
				sha256: sha256(bytes),
				type: 'file'
			});
		}
	}
	entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	return {
		digest: sha256(Buffer.from(JSON.stringify(entries))),
		entryCount,
		totalBytes
	};
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
	signal,
	testOnlyAfterLockCandidateOpen,
	testOnlyAfterPreviousRuntimeMove,
	testOnlyAfterPreviousReceiptMove,
	testOnlyAfterRuntimePublish,
	testOnlyAfterReceiptPublish,
	testOnlyAfterRollbackRuntimeDetach,
	testOnlyAfterPreviousRuntimeRestore
} = {}) {
	if (!sourceDir) {
		throw new Error('wasm debug sync requires an explicit source directory.');
	}
	const fallbackAbortError = new DOMException('wasm debug publication aborted', 'AbortError');
	if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
	const resolvedSource = path.resolve(sourceDir);
	const resolvedStatic = path.resolve(staticDir);
	const resolvedVersionModule = path.resolve(versionModulePath);
	await mkdir(resolvedStatic, { recursive: true });
	await mkdir(path.dirname(resolvedVersionModule), { recursive: true });

	const lockPaths = [
		path.join(resolvedStatic, '.wasm-debug.sync.lock'),
		path.join(
			path.dirname(resolvedVersionModule),
			`.${path.basename(resolvedVersionModule)}.sync.lock`
		)
	].sort((left, right) => left.localeCompare(right, 'en'));
	let releaseQueue;
	const queueGate = new Promise((resolve) => {
		releaseQueue = resolve;
	});
	// Reserve every overlapping target synchronously before awaiting predecessors.
	const queueRecords = [];
	for (const lockPath of [...new Set(lockPaths)]) {
		const predecessor = publicationQueues.get(lockPath) ?? Promise.resolve();
		const ready = predecessor.catch(() => undefined);
		const tail = ready.then(() => queueGate);
		publicationQueues.set(lockPath, tail);
		queueRecords.push({ lockPath, ready, tail });
	}
	let queueAbortListener;
	try {
		const ready = Promise.all(queueRecords.map((record) => record.ready));
		if (!signal) {
			await ready;
		} else {
			await Promise.race([
				ready,
				new Promise((resolve, reject) => {
					queueAbortListener = () => reject(signal.reason ?? fallbackAbortError);
					if (signal.aborted) queueAbortListener();
					else signal.addEventListener('abort', queueAbortListener, { once: true });
				})
			]);
		}
	} catch (error) {
		releaseQueue();
		for (const { lockPath, tail } of queueRecords) {
			void tail.then(() => {
				if (publicationQueues.get(lockPath) === tail) publicationQueues.delete(lockPath);
			});
		}
		throw error;
	} finally {
		if (queueAbortListener) signal?.removeEventListener('abort', queueAbortListener);
	}

	const locks = [];
	let publicationError;
	try {
		if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
		for (const lockPath of [...new Set(lockPaths)]) {
			// Expose only a fully initialized inode at the canonical cross-process lock path.
			const candidatePath = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
			let handle;
			try {
				handle = await open(candidatePath, 'wx', 0o600);
			} catch (error) {
				if (error && typeof error === 'object' && error.code === 'EEXIST') {
					throw new Error(
						`wasm debug publication lock candidate already exists: ${candidatePath}`,
						{ cause: error }
					);
				}
				throw error;
			}
			const token = randomUUID();
			const lock = {
				candidatePath,
				canonicalLinked: false,
				handle,
				initialized: false,
				lockPath,
				stats: null,
				token
			};
			locks.push(lock);
			await testOnlyAfterLockCandidateOpen?.({ candidatePath, lockPath });
			await handle.writeFile(
				`${JSON.stringify({ format: 'wasm-debug-sync-lock-v1', pid: process.pid, token })}\n`,
				'utf8'
			);
			await handle.sync();
			lock.stats = await handle.stat();
			lock.initialized = true;
			try {
				await link(candidatePath, lockPath);
				lock.canonicalLinked = true;
			} catch (error) {
				if (error && typeof error === 'object' && error.code === 'EEXIST') {
					throw new Error(
						`wasm debug publication lock already exists; verify no publisher is active before removing it: ${lockPath}`,
						{ cause: error }
					);
				}
				throw error;
			}
			const canonicalStats = await lstat(lockPath);
			if (canonicalStats.dev !== lock.stats.dev || canonicalStats.ino !== lock.stats.ino) {
				throw new Error('wasm debug publication lock ownership changed during acquisition');
			}
			await unlink(candidatePath);
		}

		const { manifestPath, manifestBytes, assets } = await validateSourceBundle(resolvedSource);
		if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
		const expectedVersionModule = renderVersionModule(manifestBytes);
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
		const baselineRuntimeStats = await lstat(current).catch(() => null);
		let baselineRuntimeSnapshot;
		if (baselineRuntimeStats) {
			if (!baselineRuntimeStats.isDirectory() || baselineRuntimeStats.isSymbolicLink()) {
				throw new Error('installed wasm debug runtime must be a real directory');
			}
			baselineRuntimeSnapshot = await snapshotInstalledRuntime(current);
		}
		const baselineVersionStats = await lstat(resolvedVersionModule).catch(() => null);
		let baselineVersionModule;
		if (baselineVersionStats) {
			if (!baselineVersionStats.isFile() || baselineVersionStats.isSymbolicLink()) {
				throw new Error('wasm debug version module path must be a regular file');
			}
			baselineVersionModule = await readFile(resolvedVersionModule, 'utf8');
		}
		let movedPrevious = false;
		let movedPreviousVersion = false;
		let installedNext = false;
		let installedNextVersion = false;
		let previousRuntimeStats;
		let previousVersionStats;
		let installedRuntimeStats;
		let installedVersionStats;
		let nextRuntimeSnapshot;
		let stagedVersionStats;
		let preserveRecoveryFiles = false;
		try {
			await mkdir(next, { recursive: true });
			await cp(manifestPath, path.join(next, 'runtime-manifest.v2.json'));
			for (const asset of assets) {
				const destination = resolveContained(next, asset.path);
				await mkdir(path.dirname(destination), { recursive: true });
				await cp(resolveContained(resolvedSource, asset.path), destination);
			}
			await writeFile(nextVersionModule, expectedVersionModule);
			await verifySyncedWasmDebugDist({
				staticDir: nextRoot,
				versionModulePath: nextVersionModule
			});
			nextRuntimeSnapshot = await snapshotInstalledRuntime(next);
			stagedVersionStats = await lstat(nextVersionModule);
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			if (baselineRuntimeStats) {
				await mkdir(previousRoot, { recursive: true });
				await rename(current, previous);
				movedPrevious = true;
				previousRuntimeStats = await lstat(previous);
				await testOnlyAfterPreviousRuntimeMove?.();
				if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			}
			if (baselineVersionStats) {
				await rename(resolvedVersionModule, previousVersionModule);
				movedPreviousVersion = true;
				previousVersionStats = await lstat(previousVersionModule);
				await testOnlyAfterPreviousReceiptMove?.();
				if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			}
			await rename(next, current);
			installedNext = true;
			installedRuntimeStats = await lstat(current);
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			await testOnlyAfterRuntimePublish?.();
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			await rename(nextVersionModule, resolvedVersionModule);
			installedNextVersion = true;
			installedVersionStats = await lstat(resolvedVersionModule);
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			await testOnlyAfterReceiptPublish?.();
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
			await verifySyncedWasmDebugDist({
				staticDir: resolvedStatic,
				versionModulePath: resolvedVersionModule
			});
			if (signal?.aborted) throw signal.reason ?? fallbackAbortError;
		} catch (error) {
			// Validate the complete four-path phase before performing any destructive rollback.
			const ownershipErrors = [];
			const currentRuntimeStats = await lstat(current).catch(() => null);
			if (installedNext) {
				if (
					!installedRuntimeStats ||
					!currentRuntimeStats ||
					currentRuntimeStats.dev !== installedRuntimeStats.dev ||
					currentRuntimeStats.ino !== installedRuntimeStats.ino
				) {
					ownershipErrors.push(
						new Error(
							'wasm debug runtime ownership changed before publication rollback'
						)
					);
				} else {
					try {
						const currentSnapshot = await snapshotInstalledRuntime(current);
						if (
							!nextRuntimeSnapshot ||
							currentSnapshot.digest !== nextRuntimeSnapshot.digest
						) {
							throw new Error('wasm debug runtime snapshot changed');
						}
					} catch (ownershipError) {
						ownershipErrors.push(
							new Error(
								'wasm debug runtime ownership changed before publication rollback',
								{
									cause: ownershipError
								}
							)
						);
					}
				}
			} else if (movedPrevious) {
				if (currentRuntimeStats) {
					ownershipErrors.push(
						new Error(
							'wasm debug runtime destination changed before publication rollback'
						)
					);
				}
			} else if (!baselineRuntimeStats) {
				if (currentRuntimeStats) {
					ownershipErrors.push(
						new Error('wasm debug runtime appeared before publication rollback')
					);
				}
			} else if (
				!currentRuntimeStats ||
				currentRuntimeStats.dev !== baselineRuntimeStats.dev ||
				currentRuntimeStats.ino !== baselineRuntimeStats.ino
			) {
				ownershipErrors.push(
					new Error('wasm debug baseline runtime ownership changed before rollback')
				);
			} else {
				try {
					const currentSnapshot = await snapshotInstalledRuntime(current);
					if (currentSnapshot.digest !== baselineRuntimeSnapshot.digest) {
						throw new Error('wasm debug baseline runtime snapshot changed');
					}
				} catch (ownershipError) {
					ownershipErrors.push(
						new Error('wasm debug baseline runtime content changed before rollback', {
							cause: ownershipError
						})
					);
				}
			}

			const currentVersionStats = await lstat(resolvedVersionModule).catch(() => null);
			if (installedNextVersion) {
				const currentReceipt = await readFile(resolvedVersionModule, 'utf8').catch(
					() => null
				);
				if (
					!installedVersionStats ||
					!currentVersionStats ||
					currentVersionStats.dev !== installedVersionStats.dev ||
					currentVersionStats.ino !== installedVersionStats.ino ||
					currentReceipt !== expectedVersionModule
				) {
					ownershipErrors.push(
						new Error(
							'wasm debug receipt ownership changed before publication rollback'
						)
					);
				}
			} else if (movedPreviousVersion || installedNext) {
				if (currentVersionStats) {
					ownershipErrors.push(
						new Error(
							'wasm debug receipt destination changed before publication rollback'
						)
					);
				}
			} else if (!baselineVersionStats) {
				if (currentVersionStats) {
					ownershipErrors.push(
						new Error('wasm debug receipt appeared before publication rollback')
					);
				}
			} else {
				const currentReceipt = await readFile(resolvedVersionModule, 'utf8').catch(
					() => null
				);
				if (
					!currentVersionStats ||
					currentVersionStats.dev !== baselineVersionStats.dev ||
					currentVersionStats.ino !== baselineVersionStats.ino ||
					currentReceipt !== baselineVersionModule
				) {
					ownershipErrors.push(
						new Error('wasm debug baseline receipt changed before publication rollback')
					);
				}
			}

			const currentPreviousStats = await lstat(previous).catch(() => null);
			if (movedPrevious) {
				if (
					!baselineRuntimeStats ||
					!previousRuntimeStats ||
					!currentPreviousStats ||
					previousRuntimeStats.dev !== baselineRuntimeStats.dev ||
					previousRuntimeStats.ino !== baselineRuntimeStats.ino ||
					currentPreviousStats.dev !== previousRuntimeStats.dev ||
					currentPreviousStats.ino !== previousRuntimeStats.ino
				) {
					ownershipErrors.push(
						new Error('wasm debug previous runtime ownership changed before rollback')
					);
				} else {
					try {
						const previousSnapshot = await snapshotInstalledRuntime(previous);
						if (previousSnapshot.digest !== baselineRuntimeSnapshot.digest) {
							throw new Error('wasm debug previous runtime snapshot changed');
						}
					} catch (ownershipError) {
						ownershipErrors.push(
							new Error(
								'wasm debug previous runtime content changed before rollback',
								{
									cause: ownershipError
								}
							)
						);
					}
				}
			} else if (currentPreviousStats) {
				ownershipErrors.push(
					new Error('wasm debug unexpected previous runtime appeared before rollback')
				);
			}

			const currentPreviousVersionStats = await lstat(previousVersionModule).catch(
				() => null
			);
			if (movedPreviousVersion) {
				const previousReceipt = await readFile(previousVersionModule, 'utf8').catch(
					() => null
				);
				if (
					!baselineVersionStats ||
					!previousVersionStats ||
					!currentPreviousVersionStats ||
					previousVersionStats.dev !== baselineVersionStats.dev ||
					previousVersionStats.ino !== baselineVersionStats.ino ||
					currentPreviousVersionStats.dev !== previousVersionStats.dev ||
					currentPreviousVersionStats.ino !== previousVersionStats.ino ||
					previousReceipt !== baselineVersionModule
				) {
					ownershipErrors.push(
						new Error('wasm debug previous receipt ownership changed before rollback')
					);
				}
			} else if (currentPreviousVersionStats) {
				ownershipErrors.push(
					new Error('wasm debug unexpected previous receipt appeared before rollback')
				);
			}
			if (ownershipErrors.length > 0) {
				preserveRecoveryFiles = true;
				throw new AggregateError(
					[error, ...ownershipErrors],
					'wasm debug publication ownership changed; rollback was not attempted'
				);
			}

			// Rollback is phased so a partial filesystem failure cannot mix generations.
			let detachedNext = false;
			let detachedNextVersion = false;
			let rollbackPhase;
			let rollbackPhaseError;
			const compensationErrors = [];
			let canReattachNext = true;
			try {
				if (installedNext) {
					await rename(current, next);
					detachedNext = true;
					await testOnlyAfterRollbackRuntimeDetach?.();
				}
				if (installedNextVersion) {
					await rename(resolvedVersionModule, nextVersionModule);
					detachedNextVersion = true;
				}
			} catch (detachError) {
				rollbackPhase = 'detach';
				rollbackPhaseError = detachError;
			}

			let restoredPrevious = false;
			let restoredPreviousVersion = false;
			if (!rollbackPhaseError) {
				try {
					if (movedPrevious) {
						await rename(previous, current);
						restoredPrevious = true;
						await testOnlyAfterPreviousRuntimeRestore?.();
					}
					if (movedPreviousVersion) {
						await rename(previousVersionModule, resolvedVersionModule);
						restoredPreviousVersion = true;
					}
				} catch (restoreError) {
					rollbackPhase = 'restore';
					rollbackPhaseError = restoreError;
				}
			}

			if (rollbackPhaseError && rollbackPhase === 'restore') {
				if (restoredPreviousVersion) {
					try {
						await rename(resolvedVersionModule, previousVersionModule);
						restoredPreviousVersion = false;
					} catch (compensationError) {
						canReattachNext = false;
						compensationErrors.push(compensationError);
					}
				}
				if (restoredPrevious) {
					try {
						await rename(current, previous);
						restoredPrevious = false;
					} catch (compensationError) {
						canReattachNext = false;
						compensationErrors.push(compensationError);
					}
				}
			}

			if (rollbackPhaseError && canReattachNext) {
				const compensationOwnershipErrors = [];
				if (installedNext) {
					const runtimePath = detachedNext ? next : current;
					const runtimeStats = await lstat(runtimePath).catch(() => null);
					if (
						!installedRuntimeStats ||
						!runtimeStats ||
						runtimeStats.dev !== installedRuntimeStats.dev ||
						runtimeStats.ino !== installedRuntimeStats.ino
					) {
						compensationOwnershipErrors.push(
							new Error('wasm debug runtime compensation ownership changed')
						);
					} else {
						try {
							const runtimeSnapshot = await snapshotInstalledRuntime(runtimePath);
							if (
								!nextRuntimeSnapshot ||
								runtimeSnapshot.digest !== nextRuntimeSnapshot.digest
							) {
								throw new Error('wasm debug runtime compensation snapshot changed');
							}
						} catch (ownershipError) {
							compensationOwnershipErrors.push(
								new Error('wasm debug runtime compensation ownership changed', {
									cause: ownershipError
								})
							);
						}
					}
					const runtimeDestinationStats = await lstat(
						detachedNext ? current : next
					).catch(() => null);
					if (runtimeDestinationStats) {
						compensationOwnershipErrors.push(
							new Error('wasm debug runtime compensation destination changed')
						);
					}
				}

				if (installedNextVersion) {
					const receiptPath = detachedNextVersion
						? nextVersionModule
						: resolvedVersionModule;
					const receiptStats = await lstat(receiptPath).catch(() => null);
					const receipt = await readFile(receiptPath, 'utf8').catch(() => null);
					if (
						!installedVersionStats ||
						!receiptStats ||
						receiptStats.dev !== installedVersionStats.dev ||
						receiptStats.ino !== installedVersionStats.ino ||
						receipt !== expectedVersionModule
					) {
						compensationOwnershipErrors.push(
							new Error('wasm debug receipt compensation ownership changed')
						);
					}
					const receiptDestinationStats = await lstat(
						detachedNextVersion ? resolvedVersionModule : nextVersionModule
					).catch(() => null);
					if (receiptDestinationStats) {
						compensationOwnershipErrors.push(
							new Error('wasm debug receipt compensation destination changed')
						);
					}
				} else if (stagedVersionStats) {
					const receiptStats = await lstat(nextVersionModule).catch(() => null);
					const receipt = await readFile(nextVersionModule, 'utf8').catch(() => null);
					const currentReceiptStats = await lstat(resolvedVersionModule).catch(
						() => null
					);
					if (
						!receiptStats ||
						receiptStats.dev !== stagedVersionStats.dev ||
						receiptStats.ino !== stagedVersionStats.ino ||
						receipt !== expectedVersionModule ||
						currentReceiptStats
					) {
						compensationOwnershipErrors.push(
							new Error('wasm debug staged receipt compensation ownership changed')
						);
					}
				}

				const compensationPreviousStats = await lstat(previous).catch(() => null);
				if (movedPrevious) {
					if (
						!previousRuntimeStats ||
						!compensationPreviousStats ||
						compensationPreviousStats.dev !== previousRuntimeStats.dev ||
						compensationPreviousStats.ino !== previousRuntimeStats.ino
					) {
						compensationOwnershipErrors.push(
							new Error('wasm debug previous runtime compensation ownership changed')
						);
					} else {
						try {
							const previousSnapshot = await snapshotInstalledRuntime(previous);
							if (
								!baselineRuntimeSnapshot ||
								previousSnapshot.digest !== baselineRuntimeSnapshot.digest
							) {
								throw new Error(
									'wasm debug previous runtime compensation snapshot changed'
								);
							}
						} catch (ownershipError) {
							compensationOwnershipErrors.push(
								new Error(
									'wasm debug previous runtime compensation ownership changed',
									{
										cause: ownershipError
									}
								)
							);
						}
					}
				} else if (compensationPreviousStats) {
					compensationOwnershipErrors.push(
						new Error('wasm debug unexpected previous runtime during compensation')
					);
				}

				const compensationPreviousVersionStats = await lstat(previousVersionModule).catch(
					() => null
				);
				if (movedPreviousVersion) {
					const previousReceipt = await readFile(previousVersionModule, 'utf8').catch(
						() => null
					);
					if (
						!previousVersionStats ||
						!compensationPreviousVersionStats ||
						compensationPreviousVersionStats.dev !== previousVersionStats.dev ||
						compensationPreviousVersionStats.ino !== previousVersionStats.ino ||
						previousReceipt !== baselineVersionModule
					) {
						compensationOwnershipErrors.push(
							new Error('wasm debug previous receipt compensation ownership changed')
						);
					}
				} else if (compensationPreviousVersionStats) {
					compensationOwnershipErrors.push(
						new Error('wasm debug unexpected previous receipt during compensation')
					);
				}

				if (compensationOwnershipErrors.length > 0) {
					preserveRecoveryFiles = true;
					throw new AggregateError(
						[error, rollbackPhaseError, ...compensationOwnershipErrors],
						'wasm debug compensation ownership changed; recovery files were preserved'
					);
				}

				let reattachedNext = false;
				let reattachedNextVersion = false;
				try {
					if (detachedNext) {
						await rename(next, current);
						detachedNext = false;
						reattachedNext = true;
					}
					if (detachedNextVersion) {
						await rename(nextVersionModule, resolvedVersionModule);
						detachedNextVersion = false;
						reattachedNextVersion = true;
					}
					if (installedNext) {
						const reattachedSnapshot = await snapshotInstalledRuntime(current);
						if (
							!nextRuntimeSnapshot ||
							reattachedSnapshot.digest !== nextRuntimeSnapshot.digest
						) {
							throw new Error('wasm debug reattached runtime snapshot changed');
						}
					}
					if (installedNextVersion) {
						await verifySyncedWasmDebugDist({
							staticDir: resolvedStatic,
							versionModulePath: resolvedVersionModule
						});
					}
				} catch (compensationError) {
					compensationErrors.push(compensationError);
					if (reattachedNextVersion) {
						try {
							await rename(resolvedVersionModule, nextVersionModule);
							detachedNextVersion = true;
						} catch (reattachUndoError) {
							compensationErrors.push(reattachUndoError);
						}
					}
					if (reattachedNext) {
						try {
							await rename(current, next);
							detachedNext = true;
						} catch (reattachUndoError) {
							compensationErrors.push(reattachUndoError);
						}
					}
				}
			}

			if (rollbackPhaseError) {
				preserveRecoveryFiles = true;
				const message =
					rollbackPhase === 'detach'
						? 'wasm debug publication failed and the published pair could not be detached safely'
						: 'wasm debug publication failed and the previous pair could not be restored safely';
				throw new AggregateError(
					[error, rollbackPhaseError, ...compensationErrors],
					message
				);
			}
			throw error;
		} finally {
			if (!preserveRecoveryFiles) {
				await rm(nextRoot, { recursive: true, force: true });
				await rm(nextVersionModule, { force: true });
				await rm(previousRoot, { recursive: true, force: true });
				await rm(previousVersionModule, { force: true });
			}
		}
	} catch (error) {
		publicationError = error;
	}

	const releaseErrors = [];
	for (const lock of [...locks].reverse()) {
		let closeError;
		try {
			const ownedStats = lock.stats ?? (await lock.handle.stat().catch(() => null));
			if (lock.canonicalLinked) {
				const current = await lstat(lock.lockPath).catch(() => null);
				if (
					!ownedStats ||
					!current ||
					current.dev !== ownedStats.dev ||
					current.ino !== ownedStats.ino
				) {
					throw new Error('wasm debug publication lock ownership changed');
				}
				const value = JSON.parse(await readFile(lock.lockPath, 'utf8'));
				if (
					!lock.initialized ||
					value?.format !== 'wasm-debug-sync-lock-v1' ||
					value?.pid !== process.pid ||
					value?.token !== lock.token
				) {
					throw new Error('wasm debug publication lock ownership changed');
				}
				const finalStats = await lstat(lock.lockPath).catch(() => null);
				if (
					!finalStats ||
					finalStats.dev !== ownedStats.dev ||
					finalStats.ino !== ownedStats.ino
				) {
					throw new Error('wasm debug publication lock ownership changed');
				}
				await unlink(lock.lockPath);
			}
			const candidateStats = await lstat(lock.candidatePath).catch(() => null);
			if (candidateStats) {
				if (
					!ownedStats ||
					candidateStats.dev !== ownedStats.dev ||
					candidateStats.ino !== ownedStats.ino
				) {
					throw new Error('wasm debug publication lock candidate ownership changed');
				}
				await unlink(lock.candidatePath);
			}
		} catch (error) {
			releaseErrors.push(error);
		} finally {
			try {
				await lock.handle.close();
			} catch (error) {
				closeError = error;
			}
		}
		if (closeError) releaseErrors.push(closeError);
	}
	releaseQueue();
	for (const { lockPath, tail } of queueRecords) {
		void tail.then(() => {
			if (publicationQueues.get(lockPath) === tail) publicationQueues.delete(lockPath);
		});
	}

	if (publicationError && releaseErrors.length > 0) {
		throw new AggregateError(
			[publicationError, ...releaseErrors],
			'wasm debug publication and lock release both failed'
		);
	}
	if (publicationError) throw publicationError;
	if (releaseErrors.length === 1) throw releaseErrors[0];
	if (releaseErrors.length > 1) {
		throw new AggregateError(releaseErrors, 'wasm debug publication lock releases failed');
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
