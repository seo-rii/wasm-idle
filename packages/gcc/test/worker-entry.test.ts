import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ compile: vi.fn(), run: vi.fn() }));
vi.mock('../src/compiler.js', () => ({
	createGccCompiler: vi.fn(async () => ({
		manifest: { target: 'wasm32-wasi' },
		identity: { target: 'wasm32-wasi' },
		...fixture
	})),
	createCrossGccCompiler: vi.fn()
}));

type Request = { id: number; type: string; [key: string]: unknown };
let posted: { message: any; transfer: Transferable[] }[];
async function send(data: Request) {
	await (globalThis.onmessage as unknown as (event: { data: Request }) => Promise<void>)({
		data
	});
}

beforeEach(async () => {
	vi.resetModules();
	fixture.compile.mockReset();
	fixture.run.mockReset();
	posted = [];
	vi.stubGlobal('onmessage', null);
	vi.stubGlobal('postMessage', (message: unknown, transfer: Transferable[] = []) => {
		posted.push({ message: structuredClone(message, { transfer }), transfer });
	});
	await import('../src/worker-entry.js');
	await send({ id: 0, type: 'initialize', options: { target: 'wasm32-wasi' } });
	posted = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('GCC Worker entry binary result ownership (synthetic transport only)', () => {
	it('transfers the private artifact and every exact coverage note buffer once', async () => {
		const artifactBytes = Uint8Array.of(0, 97, 115, 109);
		const notes = ['program', 'program.1'].map((stem, i) => ({
			path: `${stem}.gcno`,
			dataPath: `/profile/${stem}.gcda`,
			contents: Uint8Array.of(0, 255, i)
		}));
		fixture.compile.mockResolvedValue({
			exitCode: 0,
			stdout: '',
			stderr: '',
			stages: [],
			artifact: { bytes: artifactBytes },
			coverage: {
				format: 'gcc-gcov',
				compilerVersion: '17.0.0',
				compilerCommit: 'a'.repeat(40),
				notes
			}
		});
		await send({ id: 1, type: 'compile', request: { code: '', coverage: true } });
		expect(posted).toHaveLength(1);
		expect(posted[0].transfer).toHaveLength(3);
		expect(posted[0].message.result.artifact.bytes).toEqual(Uint8Array.of(0, 97, 115, 109));
		expect(
			posted[0].message.result.coverage.notes.map((note: { contents: Uint8Array }) => [
				...note.contents
			])
		).toEqual([
			[0, 255, 0],
			[0, 255, 1]
		]);
		expect(artifactBytes.byteLength).toBe(0);
		expect(notes.map((note) => note.contents.byteLength)).toEqual([0, 0]);
	});

	it('preserves legacy successful/failed response shapes without coverage buffers', async () => {
		for (const exitCode of [0, 9]) {
			const result = { exitCode, stdout: '', stderr: '', stages: [] };
			fixture.compile.mockResolvedValue(result);
			await send({ id: 1, type: 'compile', request: { code: '' } });
			expect(posted.at(-1)).toEqual({
				message: { id: 1, type: 'result', result },
				transfer: []
			});
		}
	});
});
