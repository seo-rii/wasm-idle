// @vitest-environment node

import { createRequire } from 'node:module';
import type { Uri } from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { createWorkspaceModelUri } from './workspace-model-uri';

// Use Monaco's actual URI implementation without importing its browser editor.
const { URI } = createRequire(import.meta.url)('monaco-editor/esm/vs/base/common/uri.js') as {
	URI: typeof Uri;
};

describe('workspace model URI serialization', () => {
	it.each([
		'main%20draft.ts',
		'main%23draft.ts',
		'main#draft.ts',
		'main?draft.ts',
		'main draft.ts',
		'한글.ts'
	])('preserves %s through native LSP synchronization and requests', (path) => {
		const uri = createWorkspaceModelUri(URI, path);
		const openedUri = uri.toString(true).toLowerCase();
		const requestedUri = uri.toString(true);
		expect(requestedUri).toBe(openedUri);
		expect(decodeURIComponent(new URL(openedUri).pathname)).toBe(`/workspace/${path}`);
		expect(uri.path).toBe(`/workspace/${path}`);
		expect(uri.toString()).toBe(URI.file(`/workspace/${path}`).toString());
		expect(URI.parse(uri.toString()).toString()).toBe(uri.toString());
	});

	it('changes only the newly created workspace URI instance', () => {
		createWorkspaceModelUri(URI, 'main%20draft.ts');
		expect(URI.file('/workspace/main%20draft.ts').toString(true)).toBe(
			'file:///workspace/main%20draft.ts'
		);
	});
});
