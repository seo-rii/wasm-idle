import { describe, expect, it } from 'vitest';
import {
	createSharedWorkspaceUrl,
	WORKSPACE_STORAGE_KEY,
	workspaceStorageKey
} from './workspaceContext';

describe('isolated shared workspace storage', () => {
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
