import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;

		listen() {
			return { dispose() {} };
		}

		dispose() {}
	}

	class MockWriter {
		dispose() {}
	}

	return { MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { getCSharpLanguageServer } from '../src/dotnet/server.js';

describe('dotnet language server', () => {
	it('hosts the threaded dotnet compiler through an in-process JSON-RPC channel', async () => {
		const statuses: string[] = [];
		const moduleSource = [
			'export function createDotnetCompiler() {',
			'  return { async compile() { return { success: true, diagnostics: [] }; } };',
			'}'
		].join('\n');
		const moduleUrl = `data:text/javascript,${encodeURIComponent(moduleSource)}`;

		const handle = await getCSharpLanguageServer({
			currentUrl: 'https://app.example.com/editor',
			dotnet: { moduleUrl },
			onStatus(status) {
				statuses.push(status.state);
			}
		});

		expect(statuses[0]).toBe('loading');
		expect(statuses).toContain('ready');
		handle.dispose();
		expect(statuses.at(-1)).toBe('disabled');
	});
});
