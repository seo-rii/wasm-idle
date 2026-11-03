// Run a compiled program in a disposable process so a Wasm trap or an infinite
// loop cannot poison the qualification host. stdin/stdout are real host FDs.
import fs from 'node:fs/promises';
import { writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WASI } from 'node:wasi';

const [program, ...args] = process.argv.slice(2);
if (!program) throw new Error('Usage: node gcc-wasi-node-runner.mjs PROGRAM.wasm [ARGS...]');
const qualification = args[0] === '--qualification-options';
if (qualification && args.length !== 2)
	throw new Error('Expected one qualification options JSON value');
const options = qualification ? JSON.parse(args[1]) : { args };
const temporary = options.preopens?.length
	? await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-wasi-preopens-'))
	: undefined;
function relativeFile(value) {
	if (
		typeof value !== 'string' ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid qualification relative filesystem path');
	return value;
}
try {
	const mounts = [];
	for (const [index, mount] of (options.preopens || []).entries()) {
		if (
			!mount.path?.startsWith('/') ||
			mount.path === '/' ||
			mount.path
				.slice(1)
				.split('/')
				.some((part) => !part || part === '.' || part === '..')
		)
			throw new Error('Invalid qualification preopen path');
		if (mount.readonly || options.filesystemLimits)
			throw new Error('Node WASI cannot enforce the requested SDK filesystem policy');
		const directory = path.join(temporary, String(index));
		await fs.mkdir(directory);
		for (const name of mount.directories || [])
			await fs.mkdir(path.join(directory, relativeFile(name)), { recursive: true });
		for (const file of mount.files || []) {
			const destination = path.join(directory, relativeFile(file.path));
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.writeFile(
				destination,
				typeof file.contents === 'string' ? file.contents : Uint8Array.from(file.contents)
			);
		}
		mounts.push({ path: mount.path, directory });
	}
	const wasi = new WASI({
		version: 'preview1',
		args: ['program', ...(options.args || [])],
		env: options.env || {},
		preopens: Object.fromEntries(mounts.map((mount) => [mount.path, mount.directory])),
		returnOnExit: true
	});
	const module = await WebAssembly.compile(await fs.readFile(program));
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	process.exitCode = wasi.start(instance);
	if (qualification) {
		const files = [];
		for (const mount of mounts) {
			for (const name of await fs.readdir(mount.directory, { recursive: true })) {
				const file = path.join(mount.directory, name);
				const metadata = await fs.lstat(file);
				if (metadata.isDirectory()) continue;
				if (!metadata.isFile())
					throw new Error('Qualification program created a nonregular file');
				files.push({
					path: path.posix.join(mount.path, name.split(path.sep).join('/')),
					contents: [...(await fs.readFile(file))]
				});
			}
		}
		files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
		// Keep machine-readable snapshots separate from the program's real stdout/stderr.
		writeSync(3, JSON.stringify({ files }));
	}
} finally {
	if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
