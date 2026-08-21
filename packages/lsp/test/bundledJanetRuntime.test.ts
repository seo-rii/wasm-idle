import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_JANET_MANIFEST_FINGERPRINT,
	BUNDLED_JANET_RUNTIME_BUNDLE,
	BUNDLED_JANET_RUNTIME_PROFILE,
	BUNDLED_JANET_RUNNER_RECEIPT
} from '../src/bundledJanetRuntime.js';

interface JanetRuntimeManifest {
	format: string;
	runtime: string;
	profileId: string;
	fingerprint: string;
	licenseExpression: string;
	artifact: Record<string, unknown>;
	components: Record<string, unknown>;
	build: Record<string, unknown>;
	license: { path: string; spdx: string; size: number; sha256: string };
	metadata: { path: string; mediaType: string; size: number; sha256: string };
	assets: Array<{ path: string; mediaType: string; size: number; sha256: string }>;
	storage: Array<{
		path: string;
		logicalPath: string;
		encoding: string;
		size: number;
		sha256: string;
	}>;
}

const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value) as string;
};

const computeFingerprint = (manifest: JanetRuntimeManifest) => {
	const hash = createHash('sha256');
	hash.update('wasm-idle:janet-runtime-manifest:v2\n');
	hash.update('format\0wasm-janet-runtime-manifest-v2\n');
	hash.update('runtime\0janet-lang-janet\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(`build\0${canonicalJson(manifest.build)}\n`);
	hash.update(
		`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
	);
	hash.update(
		`metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`
	);
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		hash.update(`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`);
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		hash.update(
			`storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`
		);
	}
	return hash.digest('hex');
};

describe('bundled Janet runtime identity', () => {
	it('pins the canonical Janet manifest graph and diagnostic worker bytes', async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL('../../../static/wasm-janet/runtime-manifest.v2.json', import.meta.url),
				'utf8'
			)
		) as JanetRuntimeManifest;
		const runnerBytes = await readFile(
			new URL('../../../static/wasm-janet/runner-worker.js', import.meta.url)
		);

		expect(manifest).toMatchObject({
			format: 'wasm-janet-runtime-manifest-v2',
			runtime: 'janet-lang-janet',
			fingerprint: BUNDLED_JANET_MANIFEST_FINGERPRINT
		});
		expect(computeFingerprint(manifest)).toBe(BUNDLED_JANET_MANIFEST_FINGERPRINT);
		expect(BUNDLED_JANET_RUNTIME_PROFILE).toMatchObject({
			profileId: manifest.profileId,
			artifactRevision: manifest.artifact.revision,
			janetVersion: (manifest.components.janet as { version: string }).version,
			emscriptenVersion: (manifest.components.emscripten as { version: string }).version,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n')
			},
			javascriptReceipt: {
				bytes: manifest.assets.find((asset) => asset.path === 'janet.js')?.size,
				sha256: manifest.assets.find((asset) => asset.path === 'janet.js')?.sha256
			},
			wasmReceipt: {
				uncompressedBytes: manifest.assets.find((asset) => asset.path === 'janet.wasm')
					?.size,
				uncompressedSha256: manifest.assets.find((asset) => asset.path === 'janet.wasm')
					?.sha256
			}
		});
		expect(BUNDLED_JANET_RUNNER_RECEIPT).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: createHash('sha256').update(runnerBytes).digest('hex')
		});
		expect(BUNDLED_JANET_RUNTIME_BUNDLE).toEqual({
			profile: BUNDLED_JANET_RUNTIME_PROFILE,
			workerReceipt: BUNDLED_JANET_RUNNER_RECEIPT
		});
	});
});
