import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_TCL_MANIFEST_FINGERPRINT,
	BUNDLED_TCL_RUNNER_RECEIPT
} from '../src/bundledTclRuntime.js';

describe('bundled Tcl runtime identity', () => {
	it('pins the deployed Wacl manifest and diagnostic worker bytes', async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL('../../../static/wasm-tcl/runtime-manifest.v2.json', import.meta.url),
				'utf8'
			)
		) as { fingerprint: string; format: string; runtime: string };
		const runnerBytes = await readFile(
			new URL('../../../static/wasm-tcl/runner-worker.js', import.meta.url)
		);

		expect(manifest).toMatchObject({
			format: 'wasm-tcl-runtime-manifest-v2',
			runtime: 'wacl',
			fingerprint: BUNDLED_TCL_MANIFEST_FINGERPRINT
		});
		expect(BUNDLED_TCL_RUNNER_RECEIPT).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: createHash('sha256').update(runnerBytes).digest('hex')
		});
	});
});
