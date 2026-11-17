// @vitest-environment node

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectPinnedContainerClangAssets } from '../../scripts/container-clang-browser-assertions.mjs';

const browserUrl = 'http://127.0.0.1:4597/wasm-idle/';

function fixture(profile: 'full' | 'c-base-v1', cxx: boolean) {
	const asset = (id: string, digit: string) => ({
		id,
		url: `${browserUrl}container-app/objects/${digit.repeat(64)}/${id}.bin`,
		delivery: { sha256: digit.repeat(64), bytes: 42 }
	});
	const clang = asset('clang', '1');
	const lld = asset('lld', '2');
	const sysroot = asset('sysroot', '3');
	const c = asset('sysroot-c', '4');
	const cpp = asset('sysroot-cxx', '5');
	return {
		profile,
		cxx,
		distribution: {
			packages:
				profile === 'full'
					? [{ id: 'llvm', assets: [clang, lld, sysroot] }]
					: [
							{ id: 'llvm', assets: [clang, lld] },
							{ id: 'llvm-sysroot-c', assets: [c] },
							{ id: 'llvm-sysroot-cxx', assets: [cpp] }
						]
		},
		requests: [
			clang,
			lld,
			...(profile === 'full' ? [sysroot] : [c, ...(cxx ? [cpp] : [])])
		].map((entry) => entry.url)
	};
}

function serveFixture(
	value: ReturnType<typeof fixture>,
	options: { corruptHash?: boolean; legacy?: boolean } = {}
) {
	const bytes = JSON.stringify(value.distribution);
	const config = {
		...(options.legacy ? {} : { sysrootProfile: value.profile }),
		manifestSha256: options.corruptHash
			? '0'.repeat(64)
			: createHash('sha256').update(bytes).digest('hex')
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: URL) => {
			if (url.href === new URL('container-app/distribution.json', browserUrl).href)
				return new Response(bytes);
			if (url.href === new URL('container-app/page-config.json', browserUrl).href)
				return Response.json(config);
			throw new Error(`Unexpected fixture request: ${url}`);
		})
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('pinned container Clang browser requests', () => {
	it.each([
		['full', false],
		['full', true],
		['c-base-v1', false],
		['c-base-v1', true]
	] as const)('accepts %s with C++ layer required=%s', async (profile, cxx) => {
		const value = fixture(profile, cxx);
		serveFixture(value);
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx })
		).resolves.toBeUndefined();
	});

	it('retains the legacy full profile when page metadata predates sysrootProfile', async () => {
		const value = fixture('full', false);
		serveFixture(value, { legacy: true });
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx: false })
		).resolves.toBeUndefined();
	});

	it.each(['clang', 'lld', 'sysroot-c', 'sysroot-cxx'])(
		'rejects a missing required %s request',
		async (id) => {
			const value = fixture('c-base-v1', true);
			serveFixture(value);
			const requests = value.requests.filter((url) => !url.endsWith(`/${id}.bin`));
			await expect(
				expectPinnedContainerClangAssets(browserUrl, requests, { cxx: true })
			).rejects.toThrow();
		}
	);

	it('requires the C++ layer for full compilation even with a C-selected response-file command', async () => {
		const value = fixture('c-base-v1', false);
		serveFixture(value);
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx: true })
		).rejects.toThrow();
	});

	it('rejects a missing split sysroot package instead of skipping its request', async () => {
		const value = fixture('c-base-v1', true);
		value.distribution.packages = value.distribution.packages.filter(
			(pkg) => pkg.id !== 'llvm-sysroot-cxx'
		);
		serveFixture(value);
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx: true })
		).rejects.toThrow();
	});

	it('rejects a changed manifest hash', async () => {
		const value = fixture('full', false);
		serveFixture(value, { corruptHash: true });
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx: false })
		).rejects.toThrow();
	});

	it('rejects a delivery URL whose content address differs from its receipt', async () => {
		const value = fixture('c-base-v1', false);
		value.distribution.packages[0].assets[0].url = `${browserUrl}container-app/objects/${'0'.repeat(64)}/clang.bin`;
		serveFixture(value);
		await expect(
			expectPinnedContainerClangAssets(browserUrl, value.requests, { cxx: false })
		).rejects.toThrow();
	});
});
