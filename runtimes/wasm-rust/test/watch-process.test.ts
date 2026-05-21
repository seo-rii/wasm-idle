import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-watch-process-'));
	tempDirs.push(dir);
	return dir;
}

async function waitForChildExit(child: ReturnType<typeof spawn>) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise((resolve) => child.once('exit', resolve));
}

async function waitForFile(filePath: string) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const stat = await fs.stat(filePath);
			if (stat.size > 0) {
				return;
			}
		} catch (error) {
			if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
				throw error;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`timed out waiting for ${filePath}`);
}

describe('watch-process', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
	});

	it('waits for a pid file and exits with the recorded exit status', async () => {
		const root = await makeTempDir();
		const pidFile = path.join(root, 'worker.pid');
		const exitFile = path.join(root, 'worker.exit.txt');
		const logFile = path.join(root, 'worker.log');
		const worker = spawn(
			'bash',
			[
				'-lc',
				`trap 'printf 17 > ${JSON.stringify(exitFile)}' EXIT; printf '%s\\n' $$ > ${JSON.stringify(pidFile)}; sleep 0.3; exit 17`
			],
			{ cwd: projectRoot, stdio: 'ignore' }
		);

		await expect(
			execFileAsync('node', ['./scripts/watch-process.mjs', '--pid-file', pidFile, '--exit-file', exitFile, '--log-file', logFile, '--timeout-seconds', '5', '--poll-ms', '50'], {
				cwd: projectRoot,
				maxBuffer: 8 * 1024 * 1024
			})
		).rejects.toMatchObject({
			code: 17,
			stdout: expect.stringContaining('WATCH_STATUS=exited')
		});
		await waitForChildExit(worker);
	});

	it('times out while the process is still alive', async () => {
		const root = await makeTempDir();
		const pidFile = path.join(root, 'worker.pid');
		const exitFile = path.join(root, 'worker.exit.txt');
		const worker = spawn(
			'bash',
			[
				'-lc',
				`trap 'printf 0 > ${JSON.stringify(exitFile)}' EXIT; printf '%s\\n' $$ > ${JSON.stringify(pidFile)}; sleep 10`
			],
			{ cwd: projectRoot, stdio: 'ignore' }
		);
		await waitForFile(pidFile);

		try {
			await expect(
				execFileAsync('node', ['./scripts/watch-process.mjs', '--pid-file', pidFile, '--exit-file', exitFile, '--timeout-seconds', '1', '--poll-ms', '50'], {
					cwd: projectRoot,
					maxBuffer: 8 * 1024 * 1024
				})
			).rejects.toMatchObject({
				code: 124,
				stdout: expect.stringContaining('WATCH_STATUS=timeout')
			});
		} finally {
			worker.kill('SIGKILL');
			await waitForChildExit(worker);
		}
	});

	it('uses the default toolchain watcher paths when only the root is provided', async () => {
		const root = await makeTempDir();
		const pidFile = path.join(root, 'wasm-rust-custom-toolchain.pid');
		const exitFile = path.join(root, 'wasm-rust-custom-toolchain.exit.txt');
		const worker = spawn(
			'bash',
			[
				'-lc',
				`trap 'printf 0 > ${JSON.stringify(exitFile)}' EXIT; printf '%s\\n' $$ > ${JSON.stringify(pidFile)}; sleep 0.2`
			],
			{ cwd: projectRoot, stdio: 'ignore' }
		);

		const { stdout } = await execFileAsync('node', ['./scripts/watch-process.mjs', '--timeout-seconds', '5', '--poll-ms', '50'], {
			cwd: projectRoot,
			env: {
				...process.env,
				WASM_RUST_CUSTOM_TOOLCHAIN_ROOT: root
			},
			maxBuffer: 8 * 1024 * 1024
		});
		await waitForChildExit(worker);
		expect(stdout).toContain('WATCH_STATUS=exited');
		expect(stdout).toContain(`WATCH_PID_FILE=${pidFile}`);
		expect(stdout).toContain(`WATCH_EXIT_FILE=${exitFile}`);
	});
});
