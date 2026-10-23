import fs from './fs.js';
import process from './process.js';
import { Buffer } from 'buffer/';
import { promisify } from 'util/';
import { EventEmitter } from 'events';
import { run as compiler } from '#rescript-compiler';
import { run as analysis } from '#rescript-analysis';
import path from 'path-browserify';

function execute(file, args, options = {}) {
	let code = 0,
		exited = false;
	const output = [],
		errors = [];
	const localFs = Object.create(fs);
	localFs.writeSync = (fd, bytes, offset = 0, length = bytes.length - offset, position) => {
		if (fd === 1 || fd === 2) {
			(fd === 1 ? output : errors).push(Buffer.from(bytes.subarray(offset, offset + length)));
			return length;
		}
		return fs.writeSync(fd, bytes, offset, length, position);
	};
	const commandProcess = {
		...process,
		versions: process.versions,
		platform: process.platform,
		argv: ['node', file, ...args.map(String)],
		env: { ...options.env },
		cwd: () => options.cwd || '/workspace',
		exit(value) {
			exited = true;
			code = value || 0;
			throw Object.assign(Error('Command exited'), { commandExit: true });
		},
		on() {}
	};
	const require = (name) => {
		if (name === 'node:fs' || name === 'fs') return localFs;
		if (name === 'node:constants') return fs.constants;
		if (name === 'node:child_process') return {};
		if (name === 'node:path') return path;
		if (name === 'node:tty' || name === 'tty') return { isatty: () => false };
		throw Error('Unsupported upstream runtime import: ' + name);
	};
	try {
		if (file.endsWith('bsc.exe')) compiler(commandProcess, require);
		else if (file.endsWith('rescript-editor-analysis.exe')) analysis(commandProcess, require);
		else throw Error('Unsupported upstream command: ' + file);
	} catch (error) {
		if (!exited && !error?.commandExit) throw error;
	}
	const stdout = Buffer.concat(output),
		stderr = Buffer.concat(errors);
	if (code)
		throw Object.assign(Error('Upstream command failed: ' + file + ' (' + code + ')'), {
			status: code,
			stdout,
			stderr
		});
	return { stdout, stderr };
}
export function execFileSync(file, args = [], options = {}) {
	return execute(file, args, options).stdout;
}
export function execSync(command, options = {}) {
	const args = command.trim().split(/\s+/);
	return execFileSync(args.shift(), args, options);
}
export function execFile(file, args, options, callback) {
	const child = Object.assign(new EventEmitter(), {
		kill() {
			child.killed = true;
			return true;
		},
		killed: false
	});
	queueMicrotask(() => {
		try {
			if (child.killed || options?.signal?.aborted)
				throw Object.assign(Error('Command aborted'), { code: 'ABORT_ERR' });
			const result = execute(file, args, options);
			callback(null, result.stdout.toString(), result.stderr.toString());
		} catch (error) {
			callback(error, error.stdout?.toString() || '', error.stderr?.toString() || '');
		}
	});
	return child;
}
execFile[promisify.custom] = (...args) =>
	new Promise((resolve, reject) =>
		execFile(...args, (error, stdout, stderr) =>
			error ? reject(error) : resolve({ stdout, stderr })
		)
	);
export function spawn() {
	throw Error('Persistent native subprocesses are unavailable in this browser profile');
}
export const exec = spawn;
