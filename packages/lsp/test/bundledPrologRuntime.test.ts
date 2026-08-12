import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
	BUNDLED_PROLOG_RUNNER_RECEIPT
} from '../src/bundledPrologRuntime.js';

interface PrologRuntimeManifest {
	format: string;
	runtime: string;
	profileId: string;
	fingerprint: string;
	package: Record<string, string>;
	toolchain: Record<string, string>;
	license: {
		path: string;
		spdx: string;
		size: number;
		sha256: string;
	};
	metadata: {
		path: string;
		mediaType: string;
		size: number;
		sha256: string;
	};
	assets: Array<{
		path: string;
		mediaType: string;
		size: number;
		sha256: string;
	}>;
	storage: Array<{
		path: string;
		logicalPath: string;
		encoding: string;
		size: number;
		sha256: string;
	}>;
}

describe('bundled Prolog runtime identity', () => {
	it('pins the canonical manifest graph and diagnostic worker bytes', async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL('../../../static/wasm-prolog/runtime-manifest.v2.json', import.meta.url),
				'utf8'
			)
		) as PrologRuntimeManifest;
		const hash = createHash('sha256');
		hash.update('wasm-idle:prolog-runtime-manifest:v2\n');
		hash.update('format\0wasm-prolog-runtime-manifest-v2\n');
		hash.update('runtime\0swipl-wasm\n');
		hash.update(`profileId\0${manifest.profileId}\n`);
		for (const [name, value] of Object.entries(manifest.package).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		)) {
			hash.update(`package\0${name}\0${value}\n`);
		}
		for (const [name, value] of Object.entries(manifest.toolchain).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		)) {
			hash.update(`toolchain\0${name}\0${value}\n`);
		}
		hash.update(
			`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
		);
		hash.update(
			`metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`
		);
		for (const asset of [...manifest.assets].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0
		)) {
			hash.update(
				`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`
			);
		}
		for (const asset of [...manifest.storage].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0
		)) {
			hash.update(
				`storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`
			);
		}

		const runnerBytes = await readFile(
			new URL('../../../static/wasm-prolog/runner-worker.js', import.meta.url)
		);

		expect(manifest).toMatchObject({
			format: 'wasm-prolog-runtime-manifest-v2',
			runtime: 'swipl-wasm',
			fingerprint: BUNDLED_PROLOG_MANIFEST_FINGERPRINT
		});
		expect(hash.digest('hex')).toBe(BUNDLED_PROLOG_MANIFEST_FINGERPRINT);
		expect(BUNDLED_PROLOG_RUNNER_RECEIPT).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: createHash('sha256').update(runnerBytes).digest('hex')
		});
	});
});
