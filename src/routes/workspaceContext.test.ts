import { describe, expect, it, vi } from 'vitest';
import {
	createSharedWorkspaceUrl,
	WORKSPACE_STORAGE_KEY,
	workspaceStorageKey
} from './workspaceContext';

describe('isolated shared workspace storage', () => {
	it('generates distinct v4 identities without the secure-context randomUUID API', () => {
		const getRandomValues = crypto.getRandomValues.bind(crypto);
		vi.stubGlobal('crypto', { getRandomValues });
		try {
			const url = new URL('http://example.test/wasm-idle/');
			const first = createSharedWorkspaceUrl(url);
			const second = createSharedWorkspaceUrl(url);
			expect(first.searchParams.get('workspace')).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
			);
			expect(workspaceStorageKey(first)).not.toBe(WORKSPACE_STORAGE_KEY);
			expect(workspaceStorageKey(second)).not.toBe(workspaceStorageKey(first));
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it('uses independent keys for imported shares and keeps that key after a reload', () => {
		const original = new URL('https://example.test/wasm-idle/#workspace=source');
		const first = createSharedWorkspaceUrl(original);
		const second = createSharedWorkspaceUrl(original);
		expect(first.hash).toBe('');
		expect(original.hash).toBe('#workspace=source');
		expect(workspaceStorageKey(first)).not.toBe(WORKSPACE_STORAGE_KEY);
		expect(workspaceStorageKey(second)).not.toBe(workspaceStorageKey(first));
		expect(workspaceStorageKey(new URL(first.toString()))).toBe(workspaceStorageKey(first));
		expect(workspaceStorageKey(new URL('https://example.test/wasm-idle/'))).toBe(
			WORKSPACE_STORAGE_KEY
		);
	});

	it('does not allow arbitrary URL values to select a storage key', () => {
		for (const id of ['', '../original', WORKSPACE_STORAGE_KEY]) {
			const url = new URL('https://example.test/wasm-idle/');
			url.searchParams.set('workspace', id);
			expect(workspaceStorageKey(url)).toBe(WORKSPACE_STORAGE_KEY);
		}
	});
});
