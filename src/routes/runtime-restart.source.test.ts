import source from './+page.svelte?raw';
import { describe, expect, it } from 'vitest';

describe('runtime restart action', () => {
	it('exposes an idle-only runtime restart without resetting workspace files', () => {
		expect(source).toMatch(
			/async function restartRuntime\(\) \{\s+if \(!terminal \|\| runningMode \|\| !executionAvailable\) return;\s+await terminal\.restartRuntime\(\);\s+saveStatus = `\$\{languageLabels\[language\]\} runtime restarted`;\s+\}/s
		);
		expect(source).toMatch(
			/<button\s+class="tool-button"\s+onclick=\{restartRuntime\}\s+disabled=\{!terminal \|\| !!runningMode \|\| !executionAvailable\}\s+title="Restart runtime"/s
		);
		expect(source).toContain('<span>Restart Runtime</span>');
	});
});
