import { compile } from 'svelte/compiler';
import { expect, it } from 'vitest';
import componentSource from './ContainerExplorer.svelte?raw';

it('compiles accessible folder controls and file actions for the existing sidebar', () => {
	const result = compile(componentSource, {
		filename: 'src/lib/playground/container/ContainerExplorer.svelte',
		generate: 'client'
	});
	expect(result.warnings).toEqual([]);
});
