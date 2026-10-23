import { createGrainCompilerHost } from './grain-host.mjs';

/** Reuse the existing js_of_ocaml Node filesystem, without any language analysis. */
export function createCobolLspHost({ files, onStdin, onStdout, onStderr }) {
	const host = createGrainCompilerHost({ files, argv: ['lsp'], onStdout, onStderr });
	const fs = host.require('node:fs');
	if (!fs.existsSync('/workspace')) fs.mkdirSync('/workspace');
	const read = fs.readSync;
	fs.readSync = (fd, buffer, offset, length, position) =>
		fd === 0
			? onStdin(buffer.subarray(offset, offset + length))
			: read(fd, buffer, offset, length, position);
	// Workspace files and bundled dialect data are read-only snapshots. In particular,
	// upstream's optional on-disk cache has no persistent storage in a browser worker.
	const readOnly = (syscall, path) => {
		throw Object.assign(new Error('Read-only browser COBOL workspace'), {
			code: 'EACCES',
			errno: -13,
			syscall,
			path: String(path)
		});
	};
	const write = fs.writeSync;
	fs.writeSync = (fd, ...args) => {
		if (fd !== 1 && fd !== 2) readOnly('write', fd);
		return write(fd, ...args);
	};
	const open = fs.openSync;
	fs.openSync = (path, flags, mode) => {
		if (
			typeof flags === 'string'
				? /[wa+]/.test(flags)
				: (flags & (1 | 2 | 64 | 512 | 1024)) !== 0
		)
			readOnly('open', path);
		return open(path, flags, mode);
	};
	for (const method of [
		'mkdirSync',
		'rmdirSync',
		'unlinkSync',
		'renameSync',
		'truncateSync',
		'ftruncateSync',
		'utimesSync'
	])
		fs[method] = (path) => readOnly(method.replace(/Sync$/, ''), path);
	for (const method of ['statSync', 'lstatSync', 'fstatSync']) {
		const original = fs[method];
		fs[method] = (...args) => ({
			...original(...args),
			isFIFO: () => false,
			isSocket: () => false
		});
	}
	return {
		...host,
		process: {
			...host.process,
			argv: ['node', '/superbol/superbol-free.js', 'lsp'],
			cwd: () => '/workspace',
			env: { COB_CONFIG_DIR: '/superbol/gnucobol-config' }
		},
		require(name) {
			if (name === 'tty' || name === 'node:tty') return { isatty: () => false };
			return host.require(name.startsWith('node:') ? name : `node:${name}`);
		}
	};
}
