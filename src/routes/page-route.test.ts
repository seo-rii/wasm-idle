import source from './+page.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('example route debug actions', () => {
	it('swaps the debug button for stop debug while a debug session is active', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/async function stopDebug\(\) \{/);
		expect(source).toMatch(/await terminal\.stop\?\.\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'debug'\}\s+<button class="action-button action-button--stop" onclick=\{stopDebug\}>/s
		);
		expect(source).toMatch(/<span>Stop Debug<\/span>/);
	});
});
