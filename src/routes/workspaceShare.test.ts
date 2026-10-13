import { describe, expect, it, vi } from 'vitest';
import { copyWorkspaceShare } from './workspaceShare';

describe('share clipboard confirmation', () => {
	it('reports success only after writing the complete URL', async () => {
		const clipboard = { writeText: vi.fn(async () => {}) };
		expect(await copyWorkspaceShare('https://example.test/#workspace=source', clipboard)).toBe(
			true
		);
		expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
			'https://example.test/#workspace=source'
		);
	});

	it('does not report success when the clipboard API is absent', async () => {
		expect(await copyWorkspaceShare('share', undefined)).toBe(false);
	});

	it('handles a permission rejection without leaking a rejected promise', async () => {
		expect(
			await copyWorkspaceShare('share', {
				writeText: async () => {
					throw new DOMException('Permission denied', 'NotAllowedError');
				}
			})
		).toBe(false);
	});

	it('handles a synchronous clipboard failure', async () => {
		expect(
			await copyWorkspaceShare('share', {
				writeText: () => {
					throw new Error('Clipboard unavailable');
				}
			})
		).toBe(false);
	});
});
