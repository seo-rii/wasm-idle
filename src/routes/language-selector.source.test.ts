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

it('keeps the Scala.js limitations and buffered input visible before execution', () => {
	expect(source).toContain("'SCALA'");
	expect(source).toContain("'.scala': 'SCALA'");
	expect(source).toContain("SCALA: 'Main.scala'");
	expect(source).toContain("SCALA: 'scala'");
	expect(source).toMatch(/preloadedStdinLanguages = new Set<PlaygroundLanguage>\([^;]*'SCALA'/);
	expect(source).toContain('Scala.js accepts buffered stdin only. Enter it before Run');
	expect(source).toContain(
		'Experimental Scala 3 / Scala.js: requires a browser with WebAssembly JSPI'
	);
	expect(source).toMatch(/JVM libraries, macros and additional dependencies are\s+unavailable\./);
});
