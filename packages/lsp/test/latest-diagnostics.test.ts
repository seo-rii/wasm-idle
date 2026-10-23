import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	startWorkerLanguageServer,
	type LspDiagnostic,
	type WorkerLanguageService
} from '../src/lsp.js';

function harness(diagnostics: WorkerLanguageService['diagnostics']) {
	let listener: (event: MessageEvent<unknown>) => void;
	const messages: any[] = [];
	startWorkerLanguageServer(
		{
			name: 'expensive-check',
			diagnosticScheduling: 'latest-only',
			diagnosticDelay: 800,
			diagnostics
		},
		{
			addEventListener(_type, callback) {
				listener = callback;
			},
			postMessage(message) {
				messages.push(message);
			}
		}
	);
	const send = (message: Record<string, unknown>) =>
		listener({ data: { jsonrpc: '2.0', ...message } } as MessageEvent);
	send({ type: 'init' });
	return {
		messages,
		send,
		change(version: number, uri = 'file:///main.rs') {
			send({
				method: 'textDocument/didChange',
				params: {
					textDocument: { uri, version },
					contentChanges: [{ text: `version ${version}` }]
				}
			});
		}
	};
}

afterEach(() => vi.useRealTimers());

describe('latest-only diagnostic scheduling', () => {
	it('runs at most one check and replaces waiting edits with the latest debounced version', async () => {
		vi.useFakeTimers();
		let finish: (value: LspDiagnostic[]) => void;
		const diagnostics = vi
			.fn<NonNullable<WorkerLanguageService['diagnostics']>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			)
			.mockResolvedValue([]);
		const host = harness(diagnostics);
		host.change(1);
		await vi.advanceTimersByTimeAsync(800);
		host.change(2);
		await vi.advanceTimersByTimeAsync(900);
		host.change(3);
		await vi.advanceTimersByTimeAsync(900);
		expect(diagnostics.mock.calls.map(([document]) => document.version)).toEqual([1]);
		finish!([
			{
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
				message: 'stale'
			}
		]);
		await vi.advanceTimersByTimeAsync(0);
		expect(diagnostics.mock.calls.map(([document]) => document.version)).toEqual([1, 3]);
		expect(
			host.messages.filter((message) => message.method === 'textDocument/publishDiagnostics')
		).toEqual([
			{
				jsonrpc: '2.0',
				method: 'textDocument/publishDiagnostics',
				params: { uri: 'file:///main.rs', diagnostics: [] }
			}
		]);
	});

	it('serializes documents and drops closed work, including close/reopen with the same version', async () => {
		vi.useFakeTimers();
		let finish: (value: LspDiagnostic[]) => void;
		const diagnostics = vi
			.fn<NonNullable<WorkerLanguageService['diagnostics']>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			)
			.mockResolvedValue([]);
		const host = harness(diagnostics);
		host.change(1);
		await vi.advanceTimersByTimeAsync(800);
		host.change(1, 'file:///closed.rs');
		await vi.advanceTimersByTimeAsync(800);
		host.send({
			method: 'textDocument/didClose',
			params: { textDocument: { uri: 'file:///closed.rs' } }
		});
		host.send({
			method: 'textDocument/didClose',
			params: { textDocument: { uri: 'file:///main.rs' } }
		});
		host.change(1);
		await vi.advanceTimersByTimeAsync(800);
		finish!([]);
		await vi.advanceTimersByTimeAsync(0);
		expect(diagnostics.mock.calls.map(([document]) => document.uri)).toEqual([
			'file:///main.rs',
			'file:///main.rs'
		]);
		expect(
			host.messages.filter((message) => message.method === 'textDocument/publishDiagnostics')
		).toHaveLength(3);
	});

	it('does not launch or publish queued work after shutdown', async () => {
		vi.useFakeTimers();
		let finish: (value: LspDiagnostic[]) => void;
		const diagnostics = vi.fn<NonNullable<WorkerLanguageService['diagnostics']>>(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const host = harness(diagnostics);
		host.change(1);
		await vi.advanceTimersByTimeAsync(800);
		host.change(2);
		await vi.advanceTimersByTimeAsync(800);
		host.send({ id: 10, method: 'shutdown' });
		finish!([]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(diagnostics).toHaveBeenCalledOnce();
		expect(
			host.messages.filter((message) => message.method === 'textDocument/publishDiagnostics')
		).toEqual([]);
	});
});
