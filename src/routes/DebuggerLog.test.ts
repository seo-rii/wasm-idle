// @vitest-environment node

import type { DebugSessionEvent } from '@wasm-idle/core';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import DebuggerLog from './DebuggerLog.svelte';

type Diagnostic = Extract<DebugSessionEvent, { type: 'output' }>;

function renderLog(diagnostics: Diagnostic[], importantDiagnostic: Diagnostic | null = null) {
	return render(DebuggerLog, { props: { diagnostics, importantDiagnostic } }).body;
}

describe('Debugger log', () => {
	it('starts collapsed and preserves output chunks as escaped text', () => {
		const html = renderLog([
			{ type: 'output', category: 'console', output: '<script>alert("debug")</script>' },
			{ type: 'output', category: 'console', output: '\nattached\n' }
		]);
		const detailsTag = html.match(/<details\b[^>]*>/u)?.[0];
		expect(detailsTag).toBeDefined();
		expect(detailsTag).not.toMatch(/\sopen(?:\s|=|>)/u);
		expect(html).toMatch(/<summary\b[^>]*>Debugger log<\/summary>/u);
		expect(html).toContain('&lt;script');
		expect(html).toContain('alert("debug")&lt;/script');
		expect(html).toContain('\nattached\n');
		expect(html).not.toMatch(/<script\b/u);
		expect(html).not.toContain('role="alert"');
	});

	it('shows important output outside the collapsed log without depending on session state', () => {
		const importantDiagnostic: Diagnostic = {
			type: 'output',
			category: 'important',
			output: 'Could not attach: <missing target>\n'
		};
		const html = renderLog([importantDiagnostic], importantDiagnostic);
		const alert = html.match(/<pre\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/pre>/u);
		expect(alert).not.toBeNull();
		expect(alert?.[1]).toContain('Could not attach: &lt;missing target');
		expect(html.indexOf('</pre>')).toBeLessThan(html.indexOf('<details'));
		expect(html).not.toMatch(/<details\b[^>]*\sopen(?:\s|=|>)/u);
		expect(html).not.toMatch(/<missing\b/u);
	});

	it('hides the log when no diagnostics are available', () => {
		expect(renderLog([])).not.toMatch(/<section\b/u);
	});
});
