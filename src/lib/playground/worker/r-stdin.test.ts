import { flushBufferedEof, flushQueuedStdin } from '$lib/playground/stdinBuffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtureKey = '__wasm_idle_r_stdin_fixture';
// The worker appends `webr.js` to its base URL; the trailing `//` turns that suffix into a comment.
const webRModuleSource = `
const fixture = globalThis[${JSON.stringify(fixtureKey)}];
export const ChannelType = { PostMessage: 'post-message' };
export class WebR {
	constructor() {
		return fixture.webR;
	}
}
//`;
const baseUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(webRModuleSource)}`;

async function send(data: Record<string, unknown>) {
	await (globalThis as any).self.onmessage({ data });
}

describe('R worker terminal stdin', () => {
	const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => {});

	beforeEach(async () => {
		vi.resetModules();
		writeFile.mockClear();
		(globalThis as any)[fixtureKey] = {
			webR: {
				init: async () => {},
				evalRVoid: async () => {},
				close: () => {},
				FS: {
					analyzePath: async () => ({ exists: true }),
					mkdir: async () => {},
					writeFile
				},
				globalShelter: {
					captureR: async () => ({ output: [] }),
					purge: async () => {}
				}
			}
		};
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		await import('./r');
		await send({ load: true, baseUrl, log: false });
	});

	afterEach(() => {
		delete (globalThis as any)[fixtureKey];
	});

	it('writes every terminal chunk received before EOF to the stdin file', async () => {
		const buffer = new SharedArrayBuffer(4096);
		const terminalInput = ['1\n', '2\n'];
		const requests: unknown[] = [];
		(globalThis as any).postMessage = vi.fn((message: { buffer?: boolean }) => {
			if (!message?.buffer) return;
			requests.push(message);
			// Answer each request synchronously, as the host does once input is queued.
			if (!flushQueuedStdin(terminalInput, buffer)) flushBufferedEof(buffer);
		});

		await send({
			code: 'cat(sum(as.integer(readLines(stdin()))))',
			prepare: false,
			buffer,
			activePath: 'main.R',
			log: false
		});

		expect(requests).toHaveLength(3);
		const stdinWrite = writeFile.mock.calls.find(([path]) => path === '/workspace/.stdin');
		expect(new TextDecoder().decode(stdinWrite?.[1])).toBe('1\n2\n');
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});
});
