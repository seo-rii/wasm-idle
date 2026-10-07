import CompilerWorker from './compiler-performance.worker.ts?worker';
import ClangdWorker from '../packages/lsp/src/clangd/worker.ts?worker';
import { createClangdLanguageServer } from '../packages/lsp/src/clangd/server';

let compiler: Worker | undefined;
let pending: { resolve(value: unknown): void; reject(error: Error): void } | undefined;
let server: Awaited<ReturnType<typeof createClangdLanguageServer>> | undefined;
let warmClangdOperation: (() => Promise<unknown>) | undefined;

async function runCompiler(spec: unknown, warm = false) {
	if (!warm || !compiler) {
		compiler?.terminate();
		compiler = new CompilerWorker();
		compiler.onmessage = ({ data }) => {
			if (data.error) pending?.reject(new Error(data.error));
			else pending?.resolve(data);
			pending = undefined;
		};
		compiler.onerror = (event) => pending?.reject(new Error(event.message));
	}
	return new Promise((resolve, reject) => {
		pending = { resolve, reject };
		compiler!.postMessage({ spec, warm });
	});
}

async function runClangd(
	spec: {
		baseUrl: string;
		integrity: Record<string, any>;
		headers?: string | false;
		namespace: string;
		implementation?: 'shipped' | 'current';
	},
	warm = false
) {
	if (warm && warmClangdOperation) return warmClangdOperation();
	server?.dispose();
	const start = performance.now();
	const stages: { stage: string; ms: number }[] = [];
	let createServer = createClangdLanguageServer;
	let createWorker = () => new ClangdWorker();
	if (spec.implementation === 'shipped') {
		const root = '/wasm-idle/packages/lsp/src/clangd/';
		const baseline = await import(/* @vite-ignore */ `${root}.performance-baseline-server.ts`);
		const workerModule = await import(
			/* @vite-ignore */ `${root}.performance-baseline-worker.ts?worker`
		);
		createServer = baseline.createClangdLanguageServer;
		createWorker = () => new workerModule.default();
	}
	server = await createServer({
		cpp: { baseUrl: spec.baseUrl, integrity: spec.integrity, headers: spec.headers },
		persistentCache: { namespace: spec.namespace },
		createWorker,
		startupTimeoutMs: 240_000,
		assetTimeoutMs: 240_000,
		requestTimeoutMs: 240_000,
		onStatus: (status) => {
			const stage = status.state === 'loading' ? status.stage || 'loading' : status.state;
			if (stages.at(-1)?.stage !== stage)
				stages.push({ stage, ms: performance.now() - start });
		}
	});
	const readyMs = performance.now() - start;
	let id = 1;
	const waits = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
	const diagnostics = new Map<string, (value: any) => void>();
	server.transport.reader.listen((message: any) => {
		if (message.id !== undefined) {
			const wait = waits.get(message.id);
			waits.delete(message.id);
			if (message.error) wait?.reject(new Error(JSON.stringify(message.error)));
			else wait?.resolve(message.result);
		} else if (message.method === 'textDocument/publishDiagnostics')
			diagnostics.get(message.params.uri)?.(message.params.diagnostics);
	});
	const notify = (method: string, params: unknown) =>
		server!.transport.writer.write({ jsonrpc: '2.0', method, params });
	const request = (method: string, params: unknown) =>
		new Promise<any>((resolve, reject) => {
			const requestId = id++;
			waits.set(requestId, { resolve, reject });
			void server!.transport.writer
				.write({ jsonrpc: '2.0', id: requestId, method, params })
				.catch(reject);
		});
	const initialized = await request('initialize', {
		processId: null,
		rootUri: 'file:///workspace',
		capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } }
	});
	await notify('initialized', {});
	let iteration = 0;
	const documents = new Map<string, number>();
	const updateDocument = async (uri: string, languageId: string, text: string) => {
		const version = (documents.get(uri) || 0) + 1;
		documents.set(uri, version);
		if (version === 1) {
			server!.syncFile?.(new URL(uri).pathname);
			await notify('textDocument/didOpen', {
				textDocument: { uri, languageId, version, text }
			});
		} else {
			await notify('textDocument/didChange', {
				textDocument: { uri, version },
				contentChanges: [{ text }]
			});
		}
	};
	const measureOperations = async (operationStart = performance.now()) => {
		const diagnosticSamples: any[] = [];
		for (const [languageId, filename, source] of [
			[
				'cpp',
				'perf.cpp',
				'#include <bits/stdc++.h>\n#include <filesystem>\nint main() { int value = "bad"; std::vector<int> v; }\n'
			],
			[
				'c',
				'perf.c',
				'#include <stdio.h>\n#include <wchar.h>\n#include <math.h>\nint main(void) { int value = "bad"; return value; }\n'
			]
		]) {
			const uri = `file:///workspace/${filename}`;
			const opened = performance.now();
			const received = new Promise<any>((resolve) => diagnostics.set(uri, resolve));
			await updateDocument(uri, languageId, source.replace('value', `value${iteration}`));
			const values = await received;
			if (
				!values.some((entry: any) => entry.severity === 1) ||
				values.some((entry: any) => /file not found/.test(entry.message))
			)
				throw new Error(`Invalid ${languageId} diagnostics: ${JSON.stringify(values)}`);
			diagnosticSamples.push({
				languageId,
				fromStartMs: performance.now() - operationStart,
				afterOpenMs: performance.now() - opened,
				diagnostics: values.map((entry: any) => entry.message)
			});
		}
		const uri = 'file:///workspace/complete.cpp';
		const text = `#include <vector>\nint main() { std::vec } // ${iteration}\n`;
		await updateDocument(uri, 'cpp', text);
		const completion: any[] = [];
		for (let run = 0; run < 3; run++) {
			const sent = performance.now();
			const result = await request('textDocument/completion', {
				textDocument: { uri },
				position: { line: 1, character: 21 },
				context: { triggerKind: 1 }
			});
			const items = Array.isArray(result) ? result : result?.items || [];
			if (!items.some((entry: any) => entry.label.includes('vector')))
				throw new Error('clangd did not complete std::vector');
			completion.push({ ms: performance.now() - sent, count: items.length });
		}
		iteration++;
		return { diagnostics: diagnosticSamples, completion };
	};
	warmClangdOperation = async () => ({
		readyMs: 0,
		stages: [{ stage: 'existing-worker', ms: 0 }],
		...(await measureOperations())
	});
	const operations = await measureOperations(start);
	return {
		readyMs,
		stages,
		...operations,
		capabilities: { completionProvider: !!initialized.capabilities.completionProvider },
		trace: server.getDiagnosticTrace()
	};
}

Object.assign(globalThis, {
	performanceProbe: {
		runCompiler,
		runClangd,
		dispose() {
			compiler?.terminate();
			compiler = undefined;
			server?.dispose();
			server = undefined;
			warmClangdOperation = undefined;
		}
	}
});
