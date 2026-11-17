import { createHash } from 'node:crypto';
import { expect } from 'vitest';

/**
 * @param {string} browserUrl
 * @param {string[]} requests
 * @param {{ cxx: boolean }} options Whether this compilation needs the C++ sysroot layer.
 */
export async function expectPinnedContainerClangAssets(browserUrl, requests, { cxx }) {
	expect(typeof cxx).toBe('boolean');
	const base = new URL('container-app/', browserUrl);
	const [manifestResponse, configResponse] = await Promise.all([
		fetch(new URL('distribution.json', base)),
		fetch(new URL('page-config.json', base))
	]);
	expect(manifestResponse.ok).toBe(true);
	expect(configResponse.ok).toBe(true);
	const bytes = new Uint8Array(await manifestResponse.arrayBuffer());
	const config = await configResponse.json();
	expect(createHash('sha256').update(bytes).digest('hex')).toBe(config.manifestSha256);
	const distribution = JSON.parse(new TextDecoder().decode(bytes));
	/** @type {Array<[string, string]>} */
	const expectedAssets = [
		['llvm', 'clang'],
		['llvm', 'lld']
	];
	const profile = config.sysrootProfile ?? 'full';
	if (profile === 'full') {
		expectedAssets.push(['llvm', 'sysroot']);
	} else if (profile === 'c-base-v1') {
		expectedAssets.push(['llvm-sysroot-c', 'sysroot-c']);
		if (cxx) expectedAssets.push(['llvm-sysroot-cxx', 'sysroot-cxx']);
	} else {
		throw new Error(`Unsupported container sysroot profile: ${profile}`);
	}
	for (const [packageId, id] of expectedAssets) {
		const pkg = distribution.packages.find(
			(/** @type {{ id: string }} */ entry) => entry.id === packageId
		);
		expect(pkg, `Missing container package ${packageId}`).toBeDefined();
		const asset = pkg.assets.find((/** @type {{ id: string }} */ entry) => entry.id === id);
		expect(asset, `Missing container asset ${packageId}/${id}`).toBeDefined();
		const path = new URL(asset.url).pathname;
		expect(path).toContain(`/objects/${asset.delivery.sha256}/`);
		expect(asset.delivery.bytes).toBeGreaterThan(0);
		const objectPath = path.slice(path.lastIndexOf('/objects/'));
		expect(
			requests.some((url) => new URL(url).pathname.endsWith(objectPath)),
			`Missing browser request for container asset ${packageId}/${id}`
		).toBe(true);
	}
}
