import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_TCL_MANIFEST_FINGERPRINT,
	BUNDLED_TCL_RUNTIME_PROFILE,
	BUNDLED_TCL_RUNNER_RECEIPT
} from '../src/bundledTclRuntime.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('bundled Tcl runtime identity', () => {
	it('pins the deployed Wacl manifest and diagnostic worker bytes', async () => {
		const manifestBytes = await readFile(
			new URL('../../../static/wasm-tcl/runtime-manifest.v2.json', import.meta.url)
		);
		const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
			fingerprint: string;
			format: string;
			runtime: string;
			profileId: string;
			artifact: { revision: string };
			components: Record<string, { revision: string }>;
		};
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
			sha256: sha256(runnerBytes)
		});
		expect(BUNDLED_TCL_RUNTIME_PROFILE).toMatchObject({
			profileId: manifest.profileId,
			artifactRevision: manifest.artifact.revision,
			waclRevision: manifest.components.wacl?.revision,
			tclRevision: manifest.components.tcl?.revision,
			requireJsRevision: manifest.components.requirejs?.revision,
			emscriptenRevision: manifest.components.emscripten?.revision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) }
		});

		for (const [path, receipt, compressed] of [
			['require.js', BUNDLED_TCL_RUNTIME_PROFILE.requireJsReceipt, false],
			['tcl/wacl-custom.data.bin', BUNDLED_TCL_RUNTIME_PROFILE.customDataReceipt, false],
			['tcl/wacl-library.data.gz.bin', BUNDLED_TCL_RUNTIME_PROFILE.libraryDataReceipt, true],
			['tcl/wacl.js', BUNDLED_TCL_RUNTIME_PROFILE.glueReceipt, false],
			['tcl/wacl.wasm.gz.bin', BUNDLED_TCL_RUNTIME_PROFILE.wasmReceipt, true]
		] as const) {
			const bytes = await readFile(
				new URL(`../../../static/wasm-tcl/${path}`, import.meta.url)
			);
			expect(receipt).toMatchObject({ bytes: bytes.byteLength, sha256: sha256(bytes) });
			if (compressed) {
				const logical = gunzipSync(bytes);
				expect(receipt).toMatchObject({
					uncompressedBytes: logical.byteLength,
					uncompressedSha256: sha256(logical)
				});
			}
		}
	});
});
