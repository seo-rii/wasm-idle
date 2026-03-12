import source from './Monaco.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('Monaco route debug sync', () => {
	it('keeps the debug view reactive and applies markers immediately after creation', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/Monaco.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/let debugView = \$state<MonacoDebugView \| null>\(null\);/);
		expect(source).toMatch(
			/debugView = new MonacoDebugView\(Monaco, editor, onBreakpointsChange\);\s+debugView\.setBreakpoints\(breakpoints\);\s+debugView\.setPauseState\(pausedLine, debugLocals, debugLanguage\);/s
		);
	});
});
