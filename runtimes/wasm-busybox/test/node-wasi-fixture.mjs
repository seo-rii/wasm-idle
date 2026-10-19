// Trusted producer fixtures only. Node WASI is not a container sandbox.
import assert from 'node:assert/strict';
import { closeSync, fstatSync, lstatSync, openSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** Keep older phases closed to the later filesystem metadata ABI. */
export function assertBusyboxImports(imports, stage = 1) {
	assert.ok(Number.isInteger(stage) && stage >= 1 && stage <= 4, 'Invalid BusyBox command stage');
	const metadata = stage >= 3;
	assert.ok(
		imports.every(
			(entry) =>
				entry.kind === 'function' &&
				(entry.module === 'wasi_snapshot_preview1' ||
					(entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd') ||
					(metadata &&
						entry.module === 'wasm_idle_fs_v1' &&
						['path_mode', 'fd_mode'].includes(entry.name)))
		),
		'Unexpected BusyBox guest import'
	);
	assert.equal(imports.filter((entry) => entry.module === 'wasm_idle_process_v1').length, 1);
	const names = imports
		.filter((entry) => entry.module === 'wasm_idle_fs_v1')
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(names, metadata ? ['fd_mode', 'path_mode'] : []);
}

/** Upstream applets may fclose a supplied Node WASI host stdio descriptor. */
export function closeOwnedDescriptors(descriptors) {
	for (const descriptor of descriptors) {
		try {
			closeSync(descriptor);
		} catch (error) {
			if (error.code !== 'EBADF') throw error;
		}
	}
}

/**
 * Observe real successful Node WASI descriptor operations to provide the exact
 * two mode imports. Each tracked descriptor retains a separate real host fd,
 * so fstat still identifies the opened inode after rename or unlink. Preopens
 * receive guest fds from 3 in the same insertion order supplied to Node WASI.
 * Call dispose after execution, including failed instantiation.
 */
export function createNodeWasiMetadata(wasiImports, { preopens, getInstance }) {
	const descriptors = new Map();
	const original = Object.fromEntries(
		['path_open', 'fd_close', 'fd_renumber'].map((name) => [name, wasiImports[name]])
	);
	const fail = (code) => Object.assign(new Error(code), { code });
	const negativeErrno = (error) =>
		-(
			{
				EACCES: 2,
				EBADF: 8,
				EFAULT: 21,
				EILSEQ: 25,
				EINVAL: 28,
				EIO: 29,
				ELOOP: 32,
				ENAMETOOLONG: 37,
				ENOENT: 44,
				ENOTDIR: 54,
				ENOTCAPABLE: 76
			}[error.code] ?? 29
		);
	const inside = (root, path) => {
		const tail = relative(root, path);
		return tail !== '..' && !tail.startsWith('../') && !tail.startsWith('/');
	};
	const release = (fd) => {
		const entry = descriptors.get(fd);
		if (!entry) return;
		descriptors.delete(fd);
		closeOwnedDescriptors([entry.hostFd]);
	};
	const retain = (guestFd, path, root) => {
		const hostFd = openSync(path, 'r');
		const full = realpathSync(path);
		if (!inside(root, full)) {
			closeSync(hostFd);
			throw fail('ENOTCAPABLE');
		}
		release(guestFd);
		descriptors.set(guestFd, { hostFd, full, root });
	};
	let nextPreopen = 3;
	try {
		for (const [guest, host] of Object.entries(preopens)) {
			assert.ok(
				guest.startsWith('/') && !guest.includes('\0'),
				'Absolute preopen name required'
			);
			const root = realpathSync(resolve(host));
			assert.ok(statSync(root).isDirectory(), 'Fixture preopens must be directories');
			retain(nextPreopen++, root, root);
		}
	} catch (error) {
		for (const fd of [...descriptors.keys()]) release(fd);
		throw error;
	}
	const memory = () => new Uint8Array(getInstance().exports.memory.buffer);
	const target = (fd, pointer, length) => {
		const entry = descriptors.get(fd >>> 0);
		if (!entry) throw fail('EBADF');
		if (!fstatSync(entry.hostFd).isDirectory()) throw fail('ENOTDIR');
		const bytes = memory();
		pointer >>>= 0;
		length >>>= 0;
		if (pointer > bytes.length || length > bytes.length - pointer) throw fail('EFAULT');
		if (length > 4096) throw fail('ENAMETOOLONG');
		let name;
		try {
			name = new TextDecoder('utf-8', { fatal: true }).decode(
				bytes.subarray(pointer, pointer + length)
			);
		} catch {
			throw fail('EILSEQ');
		}
		if (!name) throw fail('ENOENT');
		if (name.includes('\0')) throw fail('EINVAL');
		if (name.startsWith('/')) throw fail('ENOTCAPABLE');
		// Preserve symlink/.. ordering for the real host path lookup.
		return { path: `${entry.full}/${name}`, root: entry.root };
	};
	const checkedStat = ({ path, root }, follow) => {
		const info = follow ? statSync(path) : lstatSync(path);
		const physical =
			!follow && info.isSymbolicLink() ? realpathSync(dirname(path)) : realpathSync(path);
		if (!inside(root, physical)) throw fail('ENOTCAPABLE');
		return info;
	};
	wasiImports.path_open = (...args) => {
		const result = original.path_open(...args);
		if (result === 0) {
			const { path, root } = target(args[0], args[2], args[3]);
			const guestFd = new DataView(memory().buffer).getUint32(args[8] >>> 0, true);
			retain(guestFd, path, root);
		}
		return result;
	};
	wasiImports.fd_close = (fd) => {
		const result = original.fd_close(fd);
		if (result === 0) release(fd >>> 0);
		return result;
	};
	wasiImports.fd_renumber = (from, to) => {
		const result = original.fd_renumber(from, to);
		if (result === 0 && from !== to) {
			const entry = descriptors.get(from >>> 0);
			release(to >>> 0);
			descriptors.delete(from >>> 0);
			if (entry) descriptors.set(to >>> 0, entry);
		}
		return result;
	};
	return {
		imports: {
			path_mode(fd, pointer, length, flags) {
				try {
					if (flags & ~1) return -28;
					return checkedStat(target(fd, pointer, length), !!(flags & 1)).mode & 0o777;
				} catch (error) {
					return negativeErrno(error);
				}
			},
			fd_mode(fd) {
				try {
					const entry = descriptors.get(fd >>> 0);
					return entry ? fstatSync(entry.hostFd).mode & 0o777 : -8;
				} catch (error) {
					return negativeErrno(error);
				}
			}
		},
		dispose() {
			for (const fd of [...descriptors.keys()]) release(fd);
			for (const [name, implementation] of Object.entries(original))
				wasiImports[name] = implementation;
		}
	};
}
