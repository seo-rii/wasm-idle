import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveHarnessTargetTriples } from '../scripts/browser-harness-runtime.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function runNode(args: string[], env: NodeJS.ProcessEnv = {}) {
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
	const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-browser-harness-test-'));
	const stdoutPath = path.join(captureDir, 'stdout.txt');
	const stderrPath = path.join(captureDir, 'stderr.txt');
	const shellCommand = `node ${args.map((arg) => JSON.stringify(arg)).join(' ')} >${JSON.stringify(stdoutPath)} 2>${JSON.stringify(stderrPath)}`;

	try {
		await execFileAsync('/bin/bash', ['-lc', shellCommand], {
			cwd: projectRoot,
			env: childEnv,
			maxBuffer: 128 * 1024 * 1024
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

describe('browser harness probe', () => {
	it('includes wasm32-wasip3 in the target selector options', async () => {
		const harnessHtml = await fs.readFile(
			path.join(projectRoot, 'browser-harness/index.html'),
			'utf8'
		);

		expect(harnessHtml).toContain('<option value="wasm32-wasip3">wasm32-wasip3</option>');
	});

	it('declares an inline favicon to keep the harness console free of 404 noise', async () => {
		const harnessHtml = await fs.readFile(
			path.join(projectRoot, 'browser-harness/index.html'),
			'utf8'
		);

		expect(harnessHtml).toContain('<link rel="icon" href="data:," />');
	});

	it(
		'compiles and runs hello world in Chromium when the real browser runtime is available',
		async () => {
			if (process.env.WASM_RUST_RUN_REAL_BROWSER_HARNESS !== '1') {
				return;
			}

			const { stdout, stderr } = await runNode(['./scripts/probe-browser-harness.mjs']);
			const result = JSON.parse((stdout.trim() || stderr.trim()) as string) as {
				success: boolean;
				targets: Array<{
					targetTriple: string;
					ok: boolean;
					result: {
						compile: { success: boolean; format: string | null };
						runtime: { stdout: string; exitCode: number | null } | null;
					};
				}>;
			};

			expect(result.success).toBe(true);
			expect(result.targets.length).toBeGreaterThan(0);
			for (const targetResult of result.targets) {
				expect(targetResult.ok).toBe(true);
				expect(targetResult.result.compile.success).toBe(true);
				expect(targetResult.result.runtime?.stdout).toBe('hi\n');
				expect(targetResult.result.runtime?.exitCode).toBe(0);
				if (targetResult.targetTriple === 'wasm32-wasip2') {
					expect(targetResult.result.compile.format).toBe('component');
				}
				if (targetResult.targetTriple === 'wasm32-wasip1') {
					expect(targetResult.result.compile.format).toBe('core-wasm');
				}
			}
		},
		780_000
	);

	it(
		'compiles and runs the richer wasm-idle wasip2 sample in Chromium',
		async () => {
			if (process.env.WASM_RUST_RUN_REAL_BROWSER_HARNESS !== '1') {
				return;
			}
			const availableTargetTriples = await resolveHarnessTargetTriples(projectRoot);
			if (!availableTargetTriples.includes('wasm32-wasip2')) {
				return;
			}

			const sampleProgram = `
#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

use std::env;
use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview2_label = env::args().nth(1).unwrap_or_else(|| "preview2-cli".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview2_component={}", preview2_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}
`.trim();

			const { stdout, stderr } = await runNode(['./scripts/probe-browser-harness.mjs'], {
				WASM_RUST_SAMPLE_PROGRAM: sampleProgram,
				WASM_RUST_BROWSER_HARNESS_TARGET_TRIPLES: 'wasm32-wasip2'
			});
			const result = JSON.parse((stdout.trim() || stderr.trim()) as string) as {
				success: boolean;
				targets: Array<{
					targetTriple: string;
					ok: boolean;
					result: {
						compile: { success: boolean; format: string | null };
						runtime: { stdout: string; exitCode: number | null } | null;
					};
				}>;
			};

			expect(result.success).toBe(true);
			expect(result.targets).toHaveLength(1);
			expect(result.targets[0]?.targetTriple).toBe('wasm32-wasip2');
			expect(result.targets[0]?.ok).toBe(true);
			expect(result.targets[0]?.result.compile.success).toBe(true);
			expect(result.targets[0]?.result.compile.format).toBe('component');
			expect(result.targets[0]?.result.runtime?.stdout).toContain('preview2_component=');
			expect(result.targets[0]?.result.runtime?.stdout).toContain('factorial_plus_bonus=');
			expect(result.targets[0]?.result.runtime?.exitCode).toBe(0);
		},
		780_000
	);
});
