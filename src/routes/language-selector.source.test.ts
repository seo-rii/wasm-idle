import { describe, expect, it } from 'vitest';
import source from './+page.svelte?raw';

describe('language selector source', () => {
	it('renders canonical options from the shared page registry', () => {
		expect(source).toMatch(
			/\{#each playgroundLanguages as languageOption \(languageOption\)\}\s+<option value=\{languageOption\}>\{languageLabels\[languageOption\]\}<\/option>\s+\{\/each\}/s
		);
		expect(source).not.toContain('<option value="PYTHON">');
		expect(source).not.toContain('<option value="SQLITE">');
	});
});
