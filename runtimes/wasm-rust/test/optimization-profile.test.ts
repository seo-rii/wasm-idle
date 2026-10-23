import { describe, expect, it, vi } from 'vitest';
import { compileRust, createBrowserRustCompileRequestIdentity } from '../src/compiler.js';
import { buildRustcArguments } from '../src/compiler-worker.js';
import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';
import { createIntegratedRuntimeManifestV3 } from './helpers.js';

describe('user-program optimization profiles', () => {
	it.each([
		['interactive', '0'],
		['speed', '2'],
		['size', 's']
	] as const)(
		'uses %s without changing overflow or debug-assertion semantics',
		(optimizationProfile, level) => {
			const args = buildRustcArguments(
				{ code: 'fn main() {}', optimizationProfile },
				normalizeRuntimeManifest(createIntegratedRuntimeManifestV3())
			);
			expect(args).toEqual(
				expect.arrayContaining([
					`-Copt-level=${level}`,
					'-Coverflow-checks=yes',
					'-Cdebug-assertions=yes'
				])
			);
		}
	);

	it('rejects invalid profiles and optimized debugging before starting a worker', async () => {
		const createWorker = vi.fn();
		for (const request of [
			{ optimizationProfile: 'invalid' as never },
			{ optimizationProfile: 'speed' as const, debugMode: 'lldb' as const },
			{ optimizationProfile: 'size' as const, debugMode: 'trace' as const }
		]) {
			expect(
				(await compileRust({ code: 'fn main() {}', ...request }, { createWorker })).success
			).toBe(false);
		}
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('includes the effective profile in the compilation identity', () => {
		const request = { code: 'fn main() {}' };
		expect(createBrowserRustCompileRequestIdentity(request)).toBe(
			createBrowserRustCompileRequestIdentity({
				...request,
				optimizationProfile: 'interactive'
			})
		);
		expect(createBrowserRustCompileRequestIdentity(request)).not.toBe(
			createBrowserRustCompileRequestIdentity({ ...request, optimizationProfile: 'speed' })
		);
	});
});
