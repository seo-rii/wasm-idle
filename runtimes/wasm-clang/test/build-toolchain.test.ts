import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.resolve(testDir, 'scripts', 'build-toolchain.mjs');

describe('build-toolchain script', () => {
	it('uses prefixed output environment variables to avoid generic OUT_DIR collisions', async () => {
		const { stdout } = await execFileAsync(process.execPath, [scriptPath, '--help'], {
			env: {
				...process.env,
				OUT_DIR: '/tmp/wrong-output-directory'
			}
		});

		expect(stdout).toContain('WASM_CLANG_TOOLCHAIN_OUT_DIR=');
		expect(stdout).toContain('artifacts/runtime-source');
		expect(stdout).not.toContain('/tmp/wrong-output-directory');
	});
});
