import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const llvmWasmRoot = process.env.WASM_RUST_LLVM_WASM_ROOT || '/tmp/llvm-wasm-20260317';
const realRustcRoot =
	process.env.WASM_RUST_RUSTC_ROOT ||
	path.join(os.homedir(), '.cache', 'wasm-rust-real-rustc-20260317', 'rust', 'dist-emit-ir');
const matchingNativeToolchainRoot =
	process.env.WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT ||
	path.join(
		os.homedir(),
		'.cache',
		'wasm-rust-real-rustc-20260317',
		'rust',
		'build',
		'x86_64-unknown-linux-gnu',
		'stage2'
	);

async function runNode(
	args: string[],
	env: NodeJS.ProcessEnv = {},
	options: { timeoutMs?: number } = {}
) {
	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		...env
	};
	delete childEnv.NODE_OPTIONS;
	delete childEnv.VITEST;
	for (const key of Object.keys(childEnv)) {
		if (key.startsWith('VITEST_')) {
			delete childEnv[key];
		}
	}
	const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-probe-test-'));
	const stdoutPath = path.join(captureDir, 'stdout.txt');
	const stderrPath = path.join(captureDir, 'stderr.txt');
	const shellCommand = `node ${args.map((arg) => JSON.stringify(arg)).join(' ')} >${JSON.stringify(stdoutPath)} 2>${JSON.stringify(stderrPath)}`;

	try {
		await execFileAsync('/bin/bash', ['-lc', shellCommand], {
			cwd: projectRoot,
			env: childEnv,
			maxBuffer: 64 * 1024 * 1024,
			timeout: options.timeoutMs
		});
		return {
			stdout: await fs.readFile(stdoutPath, 'utf8').catch(() => ''),
			stderr: await fs.readFile(stderrPath, 'utf8').catch(() => '')
		};
	} catch (error) {
		(error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout = await fs
			.readFile(stdoutPath, 'utf8')
			.catch(() => '');
		(error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr = await fs
			.readFile(stderrPath, 'utf8')
			.catch(() => '');
		throw error;
	} finally {
		await fs.rm(captureDir, { recursive: true, force: true });
	}
}

function parseJsonOutput(stdout: string, stderr = '') {
	const text = stdout.trim() || stderr.trim();
	if (!text) {
		throw new Error('probe produced no JSON output');
	}
	return JSON.parse(text) as Record<string, unknown>;
}

describe('real-rust backend probes', () => {
	it(
		'records the current wasm-idle clang incompatibility with Rust 1.79 LLVM IR',
		async () => {
			const probeError = (await runNode(
				[
					'--loader',
					'./scripts/node-js-extension-loader.mjs',
					'./scripts/probe-browser-clang-rust-split.mjs'
				],
				{},
				{ timeoutMs: 30_000 }
			).catch((error) => error)) as NodeJS.ErrnoException & {
				stdout?: string;
				stderr?: string;
			};
			if (!probeError) {
				throw new Error('expected browser clang incompatibility probe to fail');
			}
			const output = probeError.stderr?.trim() || probeError.stdout?.trim() || '';
			expect(output).toContain('"success": false');
			expect(output).toContain('Failed to lower Rust LLVM IR with browser clang');
		},
		30_000
	);

	it('links Rust 1.79 textual LLVM IR through llvm-wasm llc/lld when available', async () => {
		try {
			await fs.access(path.join(llvmWasmRoot, 'llc.js'));
		} catch {
			return;
		}

		const { stdout, stderr } = await runNode(['./scripts/probe-llvm-wasm-rust-split.mjs'], {
			WASM_RUST_LLVM_WASM_ROOT: llvmWasmRoot
		});
		const result = parseJsonOutput(stdout, stderr) as {
			success: boolean;
			stdout: string;
			wasmBytes: number;
		};

		expect(result.success).toBe(true);
		expect(result.stdout).toBe('hi\n');
		expect(result.wasmBytes).toBeGreaterThan(1024);
	});

	it(
		'links browser-produced Rust bitcode through llvm-wasm when the real rustc.wasm toolchain is available',
		async () => {
		if (process.env.WASM_RUST_RUN_REAL_RUSTC_SPLIT_PROBE !== '1') {
			return;
		}

		try {
			await Promise.all([
				fs.access(path.join(llvmWasmRoot, 'llc.js')),
				fs.access(path.join(realRustcRoot, 'bin', 'rustc.wasm'))
			]);
		} catch {
			return;
		}

		const { stdout, stderr } = await runNode(['./scripts/probe-browser-rustc-llvm-wasm-split.mjs'], {
			WASM_RUST_LLVM_WASM_ROOT: llvmWasmRoot,
			WASM_RUST_RUSTC_ROOT: realRustcRoot,
			WASM_RUST_TOOLCHAIN_ROOT: realRustcRoot,
			WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT: matchingNativeToolchainRoot,
			WASM_RUST_BROWSER_PROBE_TIMEOUT_MS: '60000'
		});
		const result = parseJsonOutput(stdout, stderr) as {
			success: boolean;
			stdout: string;
			wasmBytes: number;
			imports: Array<{ module: string; name: string }>;
			bitcodePath: string;
		};

		expect(result.success).toBe(true);
		expect(result.stdout).toBe('hi\n');
		expect(result.wasmBytes).toBeGreaterThan(1024);
		expect(result.imports.every((entry) => entry.module === 'wasi_snapshot_preview1')).toBe(true);
		expect(result.bitcodePath.endsWith('.no-opt.bc')).toBe(true);
		},
		180_000
	);
});
