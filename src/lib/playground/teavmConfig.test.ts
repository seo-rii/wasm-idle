import { describe, expect, it } from 'vitest';
import { resolveTeaVmAssetUrl, resolveTeaVmBaseUrl } from './teavmConfig';

describe('TeaVM config', () => {
	it('uses the default TeaVM playground base when no override is set', () => {
		expect(resolveTeaVmBaseUrl('/absproxy/5173', 'https://example.com/absproxy/5173')).toBe(
			'https://example.com/absproxy/5173/teavm/'
		);
	});

	it('resolves a relative configured base URL against the current page', () => {
		expect(
			resolveTeaVmBaseUrl('/ignored', 'https://example.com/base/page', '/teavm/')
		).toBe('https://example.com/teavm/');
		expect(resolveTeaVmAssetUrl('https://example.com/teavm/', 'worker.js')).toBe(
			'https://example.com/teavm/worker.js'
		);
	});
});
