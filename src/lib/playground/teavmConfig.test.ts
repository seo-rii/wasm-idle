import { describe, expect, it, vi } from 'vitest';

describe('TeaVM config', () => {
	it('uses the default TeaVM playground base when no env override is set', async () => {
		vi.resetModules();
		vi.stubEnv('PUBLIC_TEAVM_BASE_URL', '');
		const { resolveTeaVmBaseUrl } = await import('./teavmConfig');

		expect(resolveTeaVmBaseUrl('/absproxy/5173', 'https://example.com/absproxy/5173')).toBe(
			'https://example.com/absproxy/5173/teavm/'
		);
	});

	it('resolves relative PUBLIC_TEAVM_BASE_URL against the current page', async () => {
		vi.resetModules();
		vi.stubEnv('PUBLIC_TEAVM_BASE_URL', '/teavm/');
		const { resolveTeaVmBaseUrl, resolveTeaVmAssetUrl } = await import('./teavmConfig');

		expect(resolveTeaVmBaseUrl('/ignored', 'https://example.com/base/page')).toBe(
			'https://example.com/teavm/'
		);
		expect(resolveTeaVmAssetUrl('https://example.com/teavm/', 'worker.js')).toBe(
			'https://example.com/teavm/worker.js'
		);
	});
});
