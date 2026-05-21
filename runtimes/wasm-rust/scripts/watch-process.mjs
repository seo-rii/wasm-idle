#!/usr/bin/env node

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root =
	process.env.WASM_RUST_CUSTOM_TOOLCHAIN_ROOT ||
	process.env.WASM_RUST_REAL_RUSTC_ROOT ||
	path.join(os.homedir(), '.cache', 'wasm-rust-custom-toolchain');

const options = {
	pid: undefined,
	pidFile: process.env.WASM_RUST_BUILD_PID_FILE || path.join(root, 'wasm-rust-custom-toolchain.pid'),
	exitFile:
		process.env.WASM_RUST_BUILD_EXIT_FILE || path.join(root, 'wasm-rust-custom-toolchain.exit.txt'),
	logFile: process.env.WASM_RUST_BUILD_LOG || path.join(root, 'wasm-rust-custom-toolchain.log'),
	timeoutSeconds: Number.parseInt(process.env.WASM_RUST_WATCH_TIMEOUT_SECONDS || '300', 10),
	pollMs: Number.parseInt(process.env.WASM_RUST_WATCH_POLL_MS || '1000', 10),
	exitWaitMs: Number.parseInt(process.env.WASM_RUST_WATCH_EXIT_WAIT_MS || '3000', 10)
};

for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];
	if (argument === '--pid') {
		options.pid = Number.parseInt(process.argv[index + 1] || '', 10);
		index += 1;
		continue;
	}
	if (argument === '--pid-file') {
		options.pidFile = process.argv[index + 1] || '';
		index += 1;
		continue;
	}
	if (argument === '--exit-file') {
		options.exitFile = process.argv[index + 1] || '';
		index += 1;
		continue;
	}
	if (argument === '--log-file') {
		options.logFile = process.argv[index + 1] || '';
		index += 1;
		continue;
	}
	if (argument === '--timeout-seconds') {
		options.timeoutSeconds = Number.parseInt(process.argv[index + 1] || '', 10);
		index += 1;
		continue;
	}
	if (argument === '--poll-ms') {
		options.pollMs = Number.parseInt(process.argv[index + 1] || '', 10);
		index += 1;
		continue;
	}
	if (argument === '--exit-wait-ms') {
		options.exitWaitMs = Number.parseInt(process.argv[index + 1] || '', 10);
		index += 1;
		continue;
	}
	if (argument === '--help') {
		process.stdout.write(`Usage: node scripts/watch-process.mjs [options]

Wait for a PID to exit or time out.

Options:
  --pid <number>              PID to watch
  --pid-file <path>           Path to a file containing the PID
  --exit-file <path>          Optional exit status file written by the worker
  --log-file <path>           Optional log file path to include in output
  --timeout-seconds <number>  Stop waiting after this many seconds (default: ${options.timeoutSeconds})
  --poll-ms <number>          Poll interval in milliseconds (default: ${options.pollMs})
  --exit-wait-ms <number>     Grace period for the exit file after the PID exits (default: ${options.exitWaitMs})
`);
		process.exit(0);
	}
	process.stderr.write(`unsupported argument: ${argument}\n`);
	process.exit(2);
}

if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 0) {
	process.stderr.write(`invalid timeout seconds: ${String(options.timeoutSeconds)}\n`);
	process.exit(2);
}

if (!Number.isInteger(options.pollMs) || options.pollMs <= 0) {
	process.stderr.write(`invalid poll interval: ${String(options.pollMs)}\n`);
	process.exit(2);
}

if (!Number.isInteger(options.exitWaitMs) || options.exitWaitMs < 0) {
	process.stderr.write(`invalid exit wait interval: ${String(options.exitWaitMs)}\n`);
	process.exit(2);
}

async function readUtf8IfExists(filePath) {
	if (!filePath) {
		return undefined;
	}
	try {
		return await fs.readFile(filePath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		try {
			const procStat = requireProcStat(pid);
			if (procStat.split(') ')[1]?.startsWith('Z')) {
				return false;
			}
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				(error.code === 'ENOENT' || error.code === 'ENOTDIR')
			) {
				return false;
			}
			throw error;
		}
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
			return true;
		}
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
			return false;
		}
		throw error;
	}
}

function sleep(milliseconds) {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

function requireProcStat(pid) {
	return readFileSync(`/proc/${pid}/stat`, 'utf8');
}

function emitResult(status, pid, startedAt, exitCode) {
	const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
	process.stdout.write(`WATCH_PID=${pid}\n`);
	process.stdout.write(`WATCH_STATUS=${status}\n`);
	process.stdout.write(`WATCH_ELAPSED_SECONDS=${elapsedSeconds}\n`);
	if (options.pidFile) {
		process.stdout.write(`WATCH_PID_FILE=${options.pidFile}\n`);
	}
	if (options.exitFile) {
		process.stdout.write(`WATCH_EXIT_FILE=${options.exitFile}\n`);
	}
	if (options.logFile) {
		process.stdout.write(`WATCH_LOG_FILE=${options.logFile}\n`);
	}
	if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
		process.stdout.write(`WATCH_EXIT_CODE=${exitCode}\n`);
	}
}

let pid = options.pid;
const startedAt = Date.now();
const timeoutAt = startedAt + options.timeoutSeconds * 1000;

for (;;) {
	if (!Number.isInteger(pid) || pid <= 0) {
		const pidContents = (await readUtf8IfExists(options.pidFile))?.trim();
		pid = Number.parseInt(pidContents || '', 10);
		if ((!Number.isInteger(pid) || pid <= 0) && Date.now() >= timeoutAt) {
			process.stderr.write(`missing or invalid PID: ${options.pidFile || '<none>'}\n`);
			process.exit(2);
		}
		if (!Number.isInteger(pid) || pid <= 0) {
			await sleep(options.pollMs);
			continue;
		}
	}

	if (!isProcessAlive(pid)) {
		let exitCode;
		const exitDeadline = Date.now() + options.exitWaitMs;
		for (;;) {
			const exitContents = (await readUtf8IfExists(options.exitFile))?.trim();
			if (exitContents && exitContents !== 'NO_EXIT_STATUS_YET') {
				const parsedExitCode = Number.parseInt(exitContents, 10);
				if (Number.isInteger(parsedExitCode)) {
					exitCode = parsedExitCode;
				}
				break;
			}
			if (Date.now() >= exitDeadline) {
				break;
			}
			await sleep(Math.min(250, Math.max(1, exitDeadline - Date.now())));
		}
		emitResult('exited', pid, startedAt, exitCode);
		process.exit(typeof exitCode === 'number' ? exitCode : 0);
	}

	if (Date.now() >= timeoutAt) {
		emitResult('timeout', pid, startedAt);
		process.exit(124);
	}

	await sleep(options.pollMs);
}
