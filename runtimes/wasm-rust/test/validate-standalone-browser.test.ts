import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function runValidatorWithFakePnpm(failArgs: string[] | null = null) {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-validate-test-'));
	const logPath = path.join(tempDir, 'calls.jsonl');
	const fakePnpmPath = path.join(tempDir, 'pnpm');
	const failKey = failArgs ? failArgs.join('\u0000') : null;
	const fakePnpmScript = `#!/usr/bin/env node
const fs = require('node:fs');
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
fs.appendFileSync(
	logPath,
	JSON.stringify({
		args,
		browserHarnessEnv: process.env.WASM_RUST_RUN_REAL_BROWSER_HARNESS ?? null
	}) + '\\n'
);
if (${JSON.stringify(failKey)} && args.join('\\u0000') === ${JSON.stringify(failKey)}) {
	process.exit(17);
}
`;

	await fs.writeFile(fakePnpmPath, fakePnpmScript, 'utf8');
	await fs.chmod(fakePnpmPath, 0o755);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${tempDir}:${process.env.PATH || ''}`
	};
	delete env.NODE_OPTIONS;
	delete env.VITEST;
	for (const key of Object.keys(env)) {
		if (key.startsWith('VITEST_')) {
			delete env[key];
		}
	}

	let error: Error | null = null;
	try {
		await execFileAsync('node', ['./scripts/validate-standalone-browser.mjs'], {
			cwd: projectRoot,
			env,
			maxBuffer: 16 * 1024 * 1024
		});
	} catch (caught) {
		error = caught as Error;
	}

	const calls = (await fs.readFile(logPath, 'utf8'))
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { args: string[]; browserHarnessEnv: string | null });

	return {
		calls,
		error,
		cleanup: async () => {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	};
}

describe('validate:standalone-browser script', () => {
	it('runs the fast lane before the canonical browser ci lane', async () => {
		const run = await runValidatorWithFakePnpm();

		try {
			expect(run.error).toBeNull();
			expect(run.calls).toEqual([
				{
					args: ['run', 'test:ci:fast'],
					browserHarnessEnv: null
				},
				{
					args: ['run', 'test:ci:browser'],
					browserHarnessEnv: null
				}
			]);
		} finally {
			await run.cleanup();
		}
	});

	it('stops immediately when the canonical browser lane fails', async () => {
		const run = await runValidatorWithFakePnpm(['run', 'test:ci:browser']);

		try {
			expect(run.error).toBeTruthy();
			expect(run.calls).toEqual([
				{
					args: ['run', 'test:ci:fast'],
					browserHarnessEnv: null
				},
				{
					args: ['run', 'test:ci:browser'],
					browserHarnessEnv: null
				}
			]);
		} finally {
			await run.cleanup();
		}
	});
});
