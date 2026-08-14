import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_PERL_MANIFEST_FINGERPRINT,
	BUNDLED_PERL_RUNNER_RECEIPT
} from '../src/bundledPerlRuntime.js';

interface PerlRuntimeManifest {
	format: string;
	runtime: string;
	profileId: string;
	fingerprint: string;
	licenseExpression: string;
	artifact: Record<string, unknown>;
	components: Record<string, unknown>;
	licenses: Array<{ path: string; spdx: string; size: number; sha256: string }>;
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

const computeFingerprint = (manifest: PerlRuntimeManifest) => {
	const hash = createHash('sha256');
	hash.update('wasm-idle:perl-runtime-manifest:v2\n');
	hash.update('format\0wasm-perl-runtime-manifest-v2\n');
	hash.update('runtime\0webperl\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	for (const license of [...manifest.licenses].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		hash.update(
			`license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`
		);
	}
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

describe('bundled Perl runtime identity', () => {
	it('pins the canonical WebPerl manifest graph and diagnostic worker bytes', async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL('../../../static/wasm-perl/runtime-manifest.v2.json', import.meta.url),
				'utf8'
			)
		) as PerlRuntimeManifest;
		const runnerBytes = await readFile(
			new URL('../../../static/wasm-perl/runner-worker.js', import.meta.url)
		);

		expect(manifest).toMatchObject({
			format: 'wasm-perl-runtime-manifest-v2',
			runtime: 'webperl',
			fingerprint: BUNDLED_PERL_MANIFEST_FINGERPRINT
		});
		expect(computeFingerprint(manifest)).toBe(BUNDLED_PERL_MANIFEST_FINGERPRINT);
		expect(BUNDLED_PERL_RUNNER_RECEIPT).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: createHash('sha256').update(runnerBytes).digest('hex')
		});
	});
});
