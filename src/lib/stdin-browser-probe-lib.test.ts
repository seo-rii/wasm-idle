import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	classifyTerminalRun,
	isExecutionRuntimeAssetPath,
	isStdinEditorReady,
	withWallClockTimeout
} from '../../scripts/stdin-browser-probe-lib.mjs';

describe('classifyTerminalRun', () => {
	const completed = { id: 2, status: 'completed', exitCode: 0 };
	it('requires the current run to settle, even after expected output appears', () => {
		expect(
			classifyTerminalRun('', 'main=73', 'main=73', { ...completed, status: 'running' }, 1)
		).toBe('running');
		expect(classifyTerminalRun('', 'main=73', 'main=73', completed, 2)).toBe('running');
		expect(classifyTerminalRun('', 'main=73', 'main=73', null, 1)).toBe('running');
	});
	it.each(['preparing', 'running', 'completed'])(
		'rejects a current %s execution in the wrong language even when output matches',
		(status) => {
			expect(
				classifyTerminalRun(
					'',
					'main=73',
					'main=73',
					{ ...completed, status, language: 'CPP' },
					1,
					'PERL'
				)
			).toBe('failure');
		}
	);
	it('requires the observed language but ignores the previous execution language', () => {
		expect(classifyTerminalRun('', 'main=73', 'main=73', completed, 1, 'PERL')).toBe('failure');
		expect(
			classifyTerminalRun(
				'',
				'main=73',
				'main=73',
				{ ...completed, language: 'CPP' },
				2,
				'PERL'
			)
		).toBe('running');
		expect(
			classifyTerminalRun(
				'',
				'main=73',
				'main=73',
				{ ...completed, language: 'PERL' },
				1,
				'PERL'
			)
		).toBe('success');
	});
	it('accepts only current output with successful completion and zero exit', () => {
		expect(
			classifyTerminalRun('old main=73', 'old main=73\nother', 'main=73', completed, 1)
		).toBe('failure');
		expect(classifyTerminalRun('ready', 'ready\nmain=73', 'main=73', completed, 1)).toBe(
			'success'
		);
		expect(
			classifyTerminalRun('', 'main=73', 'main=73', { ...completed, exitCode: 1 }, 1)
		).toBe('failure');
	});
	it.each(['failed', 'cancelled', 'timed-out'])(
		'does not mistake output before %s for success',
		(status) => {
			expect(
				classifyTerminalRun(
					'',
					'main=73\nProcess finished after 12ms',
					'main=73',
					{ ...completed, status },
					1
				)
			).toBe('failure');
		}
	);
});

describe('stdin editor readiness', () => {
	afterEach(() => vi.unstubAllGlobals());

	function installDebugApi() {
		const api = {
			getEditorValue: vi.fn(() => ''),
			setEditorValue: vi.fn(),
			writeTerminalInput: vi.fn(),
			getExecutionState: vi.fn()
		};
		const selector = { value: 'CPP' };
		vi.stubGlobal('window', { __wasmIdleDebug: api });
		vi.stubGlobal('document', {
			querySelector: vi.fn((selectorName) =>
				selectorName === '#language-select' ? selector : null
			)
		});
		return { api, selector };
	}

	it('waits for the real editor model after debug functions become available', () => {
		const { api } = installDebugApi();
		expect(isStdinEditorReady()).toBe(false);
		api.getEditorValue.mockReturnValue('int main() {}');
		expect(isStdinEditorReady()).toBe(true);
	});

	it('waits for the requested language as well as a populated model', () => {
		const { api, selector } = installDebugApi();
		api.getEditorValue.mockReturnValue('print "main=73";');
		expect(isStdinEditorReady('PERL')).toBe(false);
		selector.value = 'PERL';
		expect(isStdinEditorReady('PERL')).toBe(true);
	});

	it('waits for debug functions that can edit and observe the run', () => {
		const { api } = installDebugApi();
		api.getEditorValue.mockReturnValue('int main() {}');
		vi.stubGlobal('window', {
			__wasmIdleDebug: { ...api, setEditorValue: undefined }
		});
		expect(isStdinEditorReady()).toBe(false);
		vi.stubGlobal('window', {
			__wasmIdleDebug: { ...api, getExecutionState: undefined }
		});
		expect(isStdinEditorReady()).toBe(false);
	});
});

describe('withWallClockTimeout', () => {
	it('returns a completed browser operation', async () => {
		await expect(withWallClockTimeout(Promise.resolve('done'), 50)).resolves.toBe('done');
	});

	it('rejects an unresponsive browser operation at the wall-clock deadline', async () => {
		await expect(
			withWallClockTimeout(new Promise(() => {}), 5, 'terminal read')
		).rejects.toThrow('terminal read timed out after 5ms');
	});
});

describe('stdin browser probe language selector', () => {
	it('targets the language selector instead of whichever select happens to render first', async () => {
		const source = await readFile('scripts/stdin-browser-probe-lib.mjs', 'utf8');

		expect(source).toContain("page.locator('#language-select').selectOption(language)");
		expect(source).toContain("document.querySelector('#language-select')");
		expect(source).toContain('HTMLSelectElement | null');
		expect(source).toMatch(/\?\.value\s*===\s*expectedLanguage/u);
		expect(source).not.toMatch(/(?:locator|waitForSelector)\('select'/u);
		expect(source).not.toContain("querySelector('select')");
	});
});

describe('execution asset request classification', () => {
	it('keeps the ReScript execution compiler distinct from its editor server', () => {
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-rescript/compiler.js.gz.bin')).toBe(
			true
		);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-rescript/runner-worker.js')).toBe(true);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-rescript-lsp/runtime.mjs.gz.bin')).toBe(
			false
		);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-rescript-lsp/stdlib.pack.gz.bin')).toBe(
			false
		);
		expect(isExecutionRuntimeAssetPath('/absproxy/5173/wasm-v-lsp/v_analyzer.wasm')).toBe(
			false
		);
	});
	it('retains real container compiler requests and ignores development file imports', () => {
		const prefix = '/wasm-idle/container-app/objects/' + 'a'.repeat(64) + '/';
		expect(isExecutionRuntimeAssetPath(prefix + 'clang.wasm.gz.bin')).toBe(true);
		expect(isExecutionRuntimeAssetPath(prefix + 'sysroot.tar.bin')).toBe(true);
		expect(isExecutionRuntimeAssetPath(prefix + 'unrelated.js')).toBe(false);
		expect(isExecutionRuntimeAssetPath('/@fs/project/static/wasm-rescript/compiler.js')).toBe(
			false
		);
	});
	it('classifies the Java execution compiler and its separate javacs TeaVM assets', () => {
		expect(isExecutionRuntimeAssetPath('/wasm-idle/teavm/compiler.wasm')).toBe(true);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/teavm/compiler.wasm-runtime.js')).toBe(true);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-java-lsp/javacs.wasm')).toBe(false);
		expect(isExecutionRuntimeAssetPath('/wasm-idle/wasm-java-lsp/javacs-runtime.mjs')).toBe(
			false
		);
		expect(isExecutionRuntimeAssetPath('/absproxy/5173/wasm-java-lsp/jdk-platform.zip')).toBe(
			false
		);
	});
});
