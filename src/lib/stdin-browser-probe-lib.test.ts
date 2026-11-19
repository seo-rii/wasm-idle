import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	classifyTerminalRun,
	installProgramOutputTransport,
	isExecutionRuntimeAssetPath,
	isStdinEditorReady,
	observeProgramOutput,
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

describe('program output observation', () => {
	afterEach(() => vi.unstubAllGlobals());

	function fixture() {
		let execution = 1;
		const post = vi.fn();
		class Owner extends EventTarget {
			postMessage(message: unknown, options?: unknown) {
				return post(message, options);
			}
			respond(id: number, response: Record<string, unknown>) {
				this.dispatchEvent(
					new MessageEvent('message', {
						data: { version: 1, channel: 'owner', id, ...response }
					})
				);
			}
			output(id: number, data: string | Uint8Array, event = {}) {
				this.respond(id, {
					type: 'event',
					event: { name: 'output', language: 'CPP', requestId: id, data, ...event }
				});
			}
			run(id: number, language = 'CPP') {
				this.postMessage({
					version: 1,
					channel: 'owner',
					id,
					type: 'call',
					method: 'run',
					args: [language]
				});
			}
		}
		const target = {
			__wasmIdleDebug: { getExecutionState: () => ({ id: execution, language: 'CPP' }) },
			__wasmIdleOutputProbe: undefined as
				| { matched(id: number, marker: string): boolean | undefined; stop(): void }
				| undefined
		};
		vi.stubGlobal('window', target);
		vi.stubGlobal('Worker', Owner);
		installProgramOutputTransport();
		const owner = new Owner();
		const init = {
			version: 1,
			channel: 'owner',
			type: 'init',
			id: 0,
			settings: { workspaceId: 'test' }
		};
		return {
			owner,
			post,
			init,
			target,
			Owner,
			start: (id: number) => {
				execution = id;
			},
			matched: (id: number, marker: string) =>
				target.__wasmIdleOutputProbe?.matched(id, marker)
		};
	}

	it('captures split and early markers for the dispatched execution only', () => {
		const { owner, init, start, matched, Owner } = fixture();
		owner.postMessage(init);
		expect(observeProgramOutput(['yes', '연\r\n끝', 'other'])).toBe(1);
		start(2);
		owner.run(7);
		owner.output(7, 'y');
		owner.output(7, 'es' + 'x'.repeat(70_000));
		const bytes: Uint8Array = runInNewContext('Uint8Array.from(encoded)', {
			encoded: new TextEncoder().encode('연\n끝')
		});
		expect(bytes).not.toBeInstanceOf(Uint8Array);
		owner.output(7, bytes.slice(0, 1));
		owner.output(7, bytes.slice(1));
		owner.output(8, 'other');
		owner.output(7, 'other', { requestId: 8 });
		owner.output(7, 'other', { language: 'C' });
		owner.output(7, 'other', { name: 'shell-output' });
		const event = { name: 'output', language: 'CPP', requestId: 7, data: 'other' };
		owner.respond(7, { type: 'event', event, channel: 'foreign' });
		new Owner().output(7, 'other');
		owner.respond(7, { type: 'result', value: true });
		owner.output(7, 'other');
		expect(matched(2, 'yes')).toBe(true);
		expect(matched(2, '연\r\n끝')).toBe(true);
		expect(matched(2, 'other')).toBe(false);
		expect(matched(1, 'yes')).toBe(false);
	});

	it('uses the terminal fallback without a container and detaches replaced and stopped observations', () => {
		const { target, owner, init, start, matched } = fixture();
		observeProgramOutput(['old']);
		start(2);
		owner.run(7);
		expect(matched(2, 'old')).toBeUndefined();
		owner.postMessage(init);
		owner.run(8);
		owner.output(8, 'old');
		expect(matched(2, 'old')).toBe(true);
		const remove = vi.spyOn(owner, 'removeEventListener');
		expect(observeProgramOutput(['', 'old'])).toBe(2);
		expect(remove).toHaveBeenCalledOnce();
		start(3);
		owner.run(9, 'C');
		expect(matched(3, '')).toBe(false);
		owner.run(10);
		owner.output(8, 'old');
		expect(matched(2, '')).toBe(false);
		expect(matched(3, '')).toBe(true);
		expect(matched(3, 'old')).toBe(false);
		target.__wasmIdleOutputProbe?.stop();
		expect(remove).toHaveBeenCalledTimes(2);
		expect(target.__wasmIdleOutputProbe).toBeUndefined();
	});

	it('forwards original Worker arguments, return values, errors and ordinary message events', () => {
		const { owner, init, post, start } = fixture();
		const transfers = [new ArrayBuffer(1)];
		post.mockReturnValueOnce('sent');
		expect(owner.postMessage(init, transfers)).toBe('sent');
		expect(post).toHaveBeenCalledWith(init, transfers);
		post.mockImplementationOnce(() => {
			throw new Error('worker post failed');
		});
		expect(() => owner.run(6)).toThrow('worker post failed');
		const received = vi.fn();
		owner.addEventListener('message', received);
		observeProgramOutput(['value']);
		start(2);
		owner.run(7);
		owner.output(7, 'value');
		expect(received).toHaveBeenCalledOnce();
	});

	it('uses the streamed match, execution identity and exit status together', () => {
		const state = { id: 2, language: 'CPP', status: 'completed', exitCode: 0 };
		const classify = (observed: boolean, current = state, previousId = 1) =>
			classifyTerminalRun('old', 'tail', 'tail', current, previousId, 'CPP', observed);
		expect(classify(false)).toBe('failure');
		expect(classifyTerminalRun('tail', 'tail', 'gone', state, 1, 'CPP', true)).toBe('success');
		expect(classify(true, state, 2)).toBe('running');
		expect(classify(true, { ...state, status: 'running' })).toBe('running');
		expect(classify(true, { ...state, status: 'cancelled' })).toBe('failure');
		expect(classify(true, { ...state, exitCode: 1 })).toBe('failure');
		expect(classify(true, { ...state, language: 'C' })).toBe('failure');
	});
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
	it('ignores shell command metadata loaded while the editor boots', () => {
		expect(isExecutionRuntimeAssetPath('/wasm-idle/runtimes/wasm-busybox/commands.mjs')).toBe(
			false
		);
		expect(
			isExecutionRuntimeAssetPath('/absproxy/5173/runtimes/wasm-busybox/commands.mjs')
		).toBe(false);
	});
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
		expect(isExecutionRuntimeAssetPath(prefix + 'sysroot-c.tar.gz.bin')).toBe(true);
		expect(isExecutionRuntimeAssetPath(prefix + 'sysroot-cxx.tar.gz.bin')).toBe(true);
		expect(isExecutionRuntimeAssetPath(prefix + 'sysroot-unrelated.tar.gz.bin')).toBe(false);
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

it('does not classify the shell command metadata module as a runtime download', () => {
	expect(isExecutionRuntimeAssetPath('/wasm-idle/runtimes/wasm-busybox/commands.mjs')).toBe(
		false
	);
});
