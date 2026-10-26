// @vitest-environment node

import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { adaptMonacoFullDocumentSync } from './lsp-full-sync';

// Execute the component's provider so the model chosen at this boundary is covered.
const source = readFileSync(new URL('./Monaco.svelte', import.meta.url), 'utf8');
const script = parse(source, { modern: true }).instance!;
const declaration = script.content.body
	.filter((statement) => statement.type === 'VariableDeclaration')
	.flatMap((statement) => statement.declarations)
	.find((item) => item.id.type === 'Identifier' && item.id.name === 'resolveLspConnection')!;
const initializer = declaration.init as NonNullable<typeof declaration.init> & {
	start: number;
	end: number;
};
const providerSource = transpileModule(
	`return (${source.slice(initializer.start, initializer.end)});`,
	{ compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext } }
).outputText;

function document(path: string, text: string) {
	let disposed = false;
	return {
		uri: { toString: (_skipEncoding?: boolean) => `file:///workspace/${path}` },
		getValue: () => text,
		isDisposed: () => disposed,
		dispose: () => (disposed = true)
	};
}

function connection() {
	let receive: (message: unknown) => void = () => {};
	const write = vi.fn(async (_message: unknown) => {});
	const handle = {
		transport: {
			reader: {
				listen(callback: typeof receive) {
					receive = callback;
					return { dispose() {} };
				}
			},
			writer: { write }
		},
		dispose: vi.fn()
	};
	return {
		handle,
		write,
		async change(uri: string) {
			handle.transport.reader.listen(() => {});
			await handle.transport.writer.write({ id: 1, method: 'initialize' });
			receive({ id: 1, result: { capabilities: { textDocumentSync: 1 } } });
			const message = {
				method: 'textDocument/didChange',
				params: {
					textDocument: { uri, version: 2 },
					contentChanges: [{ range: {}, text: '9' }]
				}
			};
			await handle.transport.writer.write(message);
			return message;
		}
	};
}

function provider(
	models: ReturnType<typeof document>[],
	load: () => Promise<ReturnType<typeof connection>['handle']>
) {
	const bindings = {
		$derived: (value: unknown) => value,
		lspConnectionKey: 'session-key',
		lspEnabled: true,
		activeLspLanguage: 'nim',
		disableAllLspStatuses: vi.fn(),
		lspRoutes: [{ languages: ['nim'], isEnabled: () => true, setStatus: vi.fn(), load }],
		Monaco: { editor: { getModels: () => models } },
		adaptMonacoFullDocumentSync
	};
	return new Function(...Object.keys(bindings), providerSource)(...Object.values(bindings)) as (
		language: string,
		context: { model: ReturnType<typeof document>; signal: AbortSignal }
	) => Promise<ReturnType<typeof connection>['handle']>;
}

describe('Monaco LSP session model ownership', () => {
	it.each([false, true])(
		'syncs the requested case-distinct model (reversed cache: %s)',
		async (reverse) => {
			const upper = document('Main.nim', 'let upper = 1');
			const lower = document('main.nim', 'let lower = 99');
			const models = reverse ? [lower, upper] : [upper, lower];
			for (const model of [upper, lower]) {
				const host = connection();
				await provider(models, async () => host.handle)('nim', {
					model,
					signal: new AbortController().signal
				});
				const message = await host.change('file:///workspace/main.nim');
				expect(host.write).toHaveBeenLastCalledWith({
					...message,
					params: { ...message.params, contentChanges: [{ text: model.getValue() }] }
				});
			}
		}
	);

	it('keeps concurrent connections attached to the model supplied before startup', async () => {
		const upper = document('Main.nim', 'let upper = 1');
		const lower = document('main.nim', 'let lower = 99');
		const upperHost = connection();
		const lowerHost = connection();
		let finishUpper!: (value: typeof upperHost.handle) => void;
		const loadingUpper = new Promise<typeof upperHost.handle>(
			(resolve) => (finishUpper = resolve)
		);
		const load = vi
			.fn()
			.mockReturnValueOnce(loadingUpper)
			.mockResolvedValueOnce(lowerHost.handle);
		const resolve = provider([upper, lower], load);
		const first = resolve('nim', { model: upper, signal: new AbortController().signal });
		await resolve('nim', { model: lower, signal: new AbortController().signal });
		finishUpper(upperHost.handle);
		await first;
		await upperHost.change('file:///workspace/main.nim');
		await lowerHost.change('file:///workspace/main.nim');
		for (const [host, text] of [
			[upperHost, upper.getValue()],
			[lowerHost, lower.getValue()]
		] as const) {
			expect(host.write).toHaveBeenLastCalledWith(
				expect.objectContaining({
					params: expect.objectContaining({ contentChanges: [{ text }] })
				})
			);
		}
	});

	it('does not read a disposed session model or substitute another cached document', async () => {
		const upper = document('Main.nim', 'let upper = 1');
		const lower = document('main.nim', 'let lower = 99');
		const host = connection();
		await provider([upper, lower], async () => host.handle)('nim', {
			model: lower,
			signal: new AbortController().signal
		});
		lower.dispose();
		const message = await host.change('file:///workspace/main.nim');
		expect(host.write).toHaveBeenLastCalledWith(message);
	});
});
