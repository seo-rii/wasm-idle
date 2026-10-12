import { describe, expect, it } from 'vitest';
import { consumeWorkspaceQueryInput, hasWorkspaceQueryInput } from './workspaceQuery';

describe('explicit URL workspace inputs', () => {
	it.each([
		'code',
		'code64',
		'lang',
		'args',
		'args64',
		'rustTargetTriple',
		'goTarget',
		'ocamlBackend',
		'ocamlWasmBinaryenMode'
	])('recognizes %s even when the requested value is empty', (parameter) => {
		const url = new URL('https://example.test/wasm-idle/');
		url.searchParams.set(parameter, '');
		expect(hasWorkspaceQueryInput(url)).toBe(true);
	});

	it('consumes inputs while retaining the editable workspace id and unrelated parameters', () => {
		const original = new URL(
			'https://example.test/wasm-idle/?workspace=id&code=source&lang=python&args=one&theme=dark'
		);
		const consumed = consumeWorkspaceQueryInput(original);
		expect(hasWorkspaceQueryInput(consumed)).toBe(false);
		expect(consumed.searchParams.get('workspace')).toBe('id');
		expect(consumed.searchParams.get('theme')).toBe('dark');
		expect(original.searchParams.get('code')).toBe('source');
	});
});
