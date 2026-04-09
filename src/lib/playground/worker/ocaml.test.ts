import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

async function createMockOcamlCompilerModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('OCaml worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: true,
			async json() {
				return {
					version: 1,
					generatedAt: '2026-04-10T00:00:00.000Z',
					switchPrefix: '/static/toolchain',
					findlibConf: '/static/toolchain/lib/findlib.conf',
					tools: {
						ocamlc: '/static/toolchain/bin/ocamlc.bc.browser.js',
						js_of_ocaml: '/static/toolchain/bin/js_of_ocaml.bc.browser.js',
						wasm_of_ocaml: '/static/toolchain/bin/wasm_of_ocaml.bc.browser.js'
					},
					ocamlLibFiles: [],
					packages: []
				};
			}
		}));
	});

	it('reads stdin from the shared buffer while executing browser-native js_of_ocaml output', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								var mc=0,aha=0,ow=0;
								function cz(){throw new Error("stdin bridge missing")}
								function a4I(a){var d=a.length,c=new Uint8Array(d),b=0;for(;b<d;b++)c[b]=a.charCodeAt(b);return c}
								class Base{}
								class Device extends Base{constructor(a,b){super();this.flags=b}read(a,b,c,d){cz(d,mc,aha,ow)}}
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const device=new Device(0,{});
									const bytes=new Uint8Array(64);
									const length=device.read(bytes,0,64,false);
									console.log(new TextDecoder().decode(bytes.slice(0,length)));
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl: 'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'js',
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
