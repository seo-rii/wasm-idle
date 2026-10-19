import { createHash } from 'node:crypto';
import { expect } from 'vitest';

/**
 * @param {string} browserUrl
 * @param {string[]} requests
 */
export async function expectPinnedContainerClangAssets(browserUrl, requests) {
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
	const llvm = distribution.packages.find(
		(/** @type {{ id: string }} */ pkg) => pkg.id === 'llvm'
	);
	for (const id of ['clang', 'lld', 'sysroot']) {
		const asset = llvm.assets.find((/** @type {{ id: string }} */ entry) => entry.id === id);
		const path = new URL(asset.url).pathname;
		expect(path).toContain(`/objects/${asset.delivery.sha256}/`);
		expect(asset.delivery.bytes).toBeGreaterThan(0);
		const objectPath = path.slice(path.lastIndexOf('/objects/'));
		expect(requests.some((url) => new URL(url).pathname.endsWith(objectPath))).toBe(true);
	}
}
