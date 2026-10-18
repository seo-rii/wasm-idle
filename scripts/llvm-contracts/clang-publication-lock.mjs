import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Hold one exclusive lock for both Clang output directories, including rollback.
 * The caller resolves output-directory aliases before acquiring it. Locks left
 * by interrupted processes require operator inspection; PID reuse and incomplete
 * initialization must never trigger automatic takeover.
 * @param {string} canonicalStaticDir
 */
export async function acquireClangPublicationLock(canonicalStaticDir) {
	const lockPath = path.join(canonicalStaticDir, '.wasm-clang.sync.lock');
	let handle;
	try {
		handle = await open(lockPath, 'wx', 0o600);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
			throw new Error(
				`wasm-clang publication lock already exists; verify no publisher is active before removing it: ${lockPath}`,
				{ cause: error }
			);
		}
		throw error;
	}
	const owner = await handle.stat();
	const token = randomUUID();
	/** @param {import('node:fs').Stats | null} value */
	const owned = (value) => value?.isFile() && value.dev === owner.dev && value.ino === owner.ino;
	try {
		await handle.writeFile(
			`${JSON.stringify({ format: 'wasm-clang-sync-lock-v1', pid: process.pid, token })}\n`,
			'utf8'
		);
	} catch (error) {
		try {
			if (owned(await lstat(lockPath).catch(() => null))) await unlink(lockPath);
		} finally {
			await handle.close();
		}
		throw error;
	}
	return async () => {
		try {
			if (!owned(await lstat(lockPath).catch(() => null))) {
				throw new Error(`wasm-clang publication lock ownership changed: ${lockPath}`);
			}
			const value = JSON.parse(await readFile(lockPath, 'utf8'));
			if (
				value?.format !== 'wasm-clang-sync-lock-v1' ||
				value?.pid !== process.pid ||
				value?.token !== token ||
				!owned(await lstat(lockPath).catch(() => null))
			) {
				throw new Error(`wasm-clang publication lock ownership changed: ${lockPath}`);
			}
			await unlink(lockPath);
		} finally {
			await handle.close();
		}
	};
}
