// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	setOcamlEditorSourceWhenReady,
	waitForOcamlEditorSource
} from '../../../scripts/ocaml-browser-probe-lib.mjs';

const source = 'let () = print_endline "ready"';
const debugWindow = window as Window & {
	__wasmIdleDebug?: {
		setEditorValue: (code: string) => Promise<boolean>;
		getEditorValue: () => string;
	};
};

describe('OCaml browser probe editor readiness', () => {
	beforeEach(() => {
		document.body.innerHTML =
			'<select id="language-select"><option>OCAML</option><option>CPP</option></select>';
	});

	afterEach(() => {
		delete debugWindow.__wasmIdleDebug;
		vi.restoreAllMocks();
	});

	it('waits through API registration and delayed editor creation', async () => {
		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(false);
		let editorReady = false;
		let value = '';
		debugWindow.__wasmIdleDebug = {
			setEditorValue: vi.fn(async (code) => {
				if (!editorReady) return false;
				value = code;
				return true;
			}),
			getEditorValue: () => value
		};

		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(false);
		expect(value).toBe('');
		editorReady = true;
		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(true);
		expect(value).toBe(source);
	});

	it('does not accept a failed workspace update even if the editor has the source', async () => {
		debugWindow.__wasmIdleDebug = {
			setEditorValue: async () => false,
			getEditorValue: () => source
		};
		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(false);
	});

	it('requires the requested source to remain in the editor after a write', async () => {
		debugWindow.__wasmIdleDebug = {
			setEditorValue: async () => true,
			getEditorValue: () => 'previous language source'
		};
		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(false);
	});

	it('does not write to the previous language editor', async () => {
		const setEditorValue = vi.fn(async () => true);
		debugWindow.__wasmIdleDebug = { setEditorValue, getEditorValue: () => source };
		(document.querySelector('#language-select') as HTMLSelectElement).value = 'CPP';
		await expect(setOcamlEditorSourceWhenReady(source)).resolves.toBe(false);
		expect(setEditorValue).not.toHaveBeenCalled();
	});

	it('awaits false async writes and retries until the actual editor accepts the source', async () => {
		let writes = 0;
		let value = '';
		debugWindow.__wasmIdleDebug = {
			setEditorValue: async (code) => {
				await Promise.resolve();
				if (++writes < 3) return false;
				value = code;
				return true;
			},
			getEditorValue: () => value
		};
		const page = {
			evaluate: vi.fn(
				async (write: (code: string) => Promise<boolean>, code: string) => await write(code)
			),
			waitForTimeout: vi.fn(async () => {})
		};
		await expect(waitForOcamlEditorSource(page as any, source, 1_000)).resolves.toBeUndefined();
		expect(page.evaluate).toHaveBeenCalledTimes(3);
		expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
		expect(value).toBe(source);
	});

	it('fails when readiness does not arrive within the existing deadline', async () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const page = {
			evaluate: vi.fn(async () => false),
			waitForTimeout: vi.fn(async (delayMs: number) => {
				now += delayMs;
			})
		};
		await expect(waitForOcamlEditorSource(page as any, source, 200)).rejects.toThrow(
			'timed out waiting for the OCaml editor'
		);
		expect(page.evaluate).toHaveBeenCalledTimes(2);
		expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
		expect(now).toBe(1_200);
	});
});
