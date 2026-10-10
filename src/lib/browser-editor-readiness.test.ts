// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	editorWorkspaceReady,
	selectedEditorModelReady
} from '../../scripts/browser-editor-readiness.mjs';

describe('browser editor workspace readiness', () => {
	let select: HTMLSelectElement;
	let model: { uri: string } | null;

	beforeEach(() => {
		document.body.innerHTML =
			'<select id="language-select" disabled data-workspace-ready="false">' +
			'<option value="CPP">C++</option><option value="C">C</option></select>';
		select = document.querySelector<HTMLSelectElement>('#language-select')!;
		model = { uri: 'file:///workspace/main.cpp' };
		Reflect.set(globalThis, '__wasmIdleMonacoEditor', { getModel: () => model });
	});

	afterEach(() => {
		document.body.innerHTML = '';
		Reflect.deleteProperty(globalThis, '__wasmIdleMonacoEditor');
	});

	function finishRestoration() {
		select.dataset.workspaceReady = 'true';
		select.disabled = false;
	}

	it('does not equate a visible selector and an early model with restored workspace state', () => {
		expect(editorWorkspaceReady()).toBe(false);
		select.disabled = false;
		expect(editorWorkspaceReady()).toBe(false);
	});

	it('waits for a live editor and model after restoration', () => {
		finishRestoration();
		model = null;
		expect(editorWorkspaceReady()).toBe(false);
		Reflect.deleteProperty(globalThis, '__wasmIdleMonacoEditor');
		expect(editorWorkspaceReady()).toBe(false);
	});

	it('accepts a restored empty file without requiring default source text', () => {
		finishRestoration();
		Reflect.set(globalThis, '__wasmIdleMonacoEditor', {
			getModel: () => model,
			getValue: () => ''
		});
		expect(editorWorkspaceReady()).toBe(true);
	});

	it('rejects a C selection while the active model is still C++', () => {
		finishRestoration();
		select.value = 'C';
		expect(selectedEditorModelReady({ language: 'C', fileName: 'main.c' })).toBe(false);
	});

	it('rejects a matching C model after the selector has reverted to C++', () => {
		finishRestoration();
		model = { uri: 'file:///workspace/main.c' };
		expect(selectedEditorModelReady({ language: 'C', fileName: 'main.c' })).toBe(false);
	});

	it('requires exact active URI, not a matching suffix in a different directory', () => {
		finishRestoration();
		select.value = 'C';
		model = { uri: 'file:///other/main.c' };
		expect(selectedEditorModelReady({ language: 'C', fileName: 'main.c' })).toBe(false);
		model = { uri: 'file:///workspace/main.c' };
		expect(selectedEditorModelReady({ language: 'C', fileName: 'main.c' })).toBe(true);
	});

	it('does not accept disabled controls even when the state and model match', () => {
		finishRestoration();
		select.disabled = true;
		expect(editorWorkspaceReady()).toBe(false);
		expect(selectedEditorModelReady({ language: 'CPP', fileName: 'main.cpp' })).toBe(false);
	});

	it('returns false when the page is replaced or its controls disappear', () => {
		finishRestoration();
		document.body.innerHTML = '';
		expect(editorWorkspaceReady()).toBe(false);
		expect(selectedEditorModelReady({ language: 'CPP', fileName: 'main.cpp' })).toBe(false);
	});

	it('binds the product selector and handler to the actual restoration state', () => {
		// Root Vitest runs from the repository; avoid Vite rewriting an asset URL to HTTP.
		const page = readFileSync('src/routes/+page.svelte', 'utf8');
		const selector = page.match(/<select\s+id="language-select"[\s\S]*?>/)?.[0];
		expect(selector).toContain('disabled={!workspaceInitialized}');
		expect(selector).toContain('data-workspace-ready={workspaceInitialized}');
		expect(page).toMatch(
			/function handleLanguageChange\(event: Event\) \{\s*\/\/[^\n]+\n\s*if \(!workspaceInitialized\) return;/
		);
	});
});
