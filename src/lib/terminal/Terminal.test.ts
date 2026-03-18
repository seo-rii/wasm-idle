import source from './Terminal.svelte?raw';
import Theme from './theme';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Terminal source', () => {
	it('restores the cursor and preserves selection copy handling', () => {
		expect(() =>
			compile(source, {
				filename: 'src/lib/terminal/Terminal.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/term\.write\('\\u001B\[\?25h'\);/);
		expect(source).toMatch(
			/else if \(\(ev\.ctrlKey \|\| ev\.metaKey\) && ev\.key\.toLowerCase\(\) === 'c'\) \{\s+if \(term\.hasSelection\(\)\) \{\s+const selectedText = term\.getSelection\(\);/s
		);
		expect(source).toMatch(
			/navigator\.clipboard\.writeText\(selectedText\)\.catch\(\(\) => \{\}\);/
		);
	});

	it('uses transparent backgrounds for terminal rendering layers', () => {
		expect(Theme.Tango_Dark.background).toMatch(
			/^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/
		);
		expect(Theme.Tango_Light.background).toMatch(
			/^(transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/
		);
		expect(source).toMatch(
			/:global\(\.xterm\),\s+:global\(\.xterm \.xterm-viewport\),\s+:global\(\.xterm \.composition-view\) \{\s+background-color: transparent;\s+\}/s
		);
	});

	it('exposes a stop hook and suppresses abort output for user-initiated stops', () => {
		expect(source).toMatch(/stopRequested = false;/);
		expect(source).toMatch(/if \(stopRequested\) return false;/);
		expect(source).toMatch(
			/async stop\(\) \{\s+await wait\(\);\s+stopRequested = true;\s+finish = true;\s+if \(sandbox\?\.kill\) sandbox\.kill\(\);\s+else sandbox\?\.terminate\?\.\(\);\s+\}/s
		);
	});
});
