import compilerSource from '../../../static/wasm-go/compiler.js?raw';
import browserExecutionSource from '../../../static/wasm-go/browser-execution.js?raw';
import runtimeManifestSource from '../../../static/wasm-go/runtime/runtime-manifest.v1.json?raw';
import { describe, expect, it } from 'vitest';

describe('bundled wasm-go compiler', () => {
	it('ships the asset-aware progress mapping instead of the coarse fallback ranges', () => {
		expect(compilerSource).toContain('compile: [20, 88]');
		expect(compilerSource).toContain('link: [88, 97]');
		expect(compilerSource).toContain('resolving compile inputs');
		expect(compilerSource).toContain('preparing compile runtime');
		expect(compilerSource).not.toContain('compile: [35, 75]');
		expect(compilerSource).not.toContain('link: [75, 95]');
	});

	it('ships the js/wasm browser execution path in the synced runtime bundle', () => {
		expect(runtimeManifestSource).toContain('"js/wasm"');
		expect(runtimeManifestSource).toContain('"artifactFormat": "js-wasm"');
		expect(runtimeManifestSource).toContain('"wasmExecJs": "runtime/wasm_exec.js"');
		expect(compilerSource).toContain("target.execution.kind === 'js-wasm-exec'");
		expect(browserExecutionSource).toContain("artifact.target === 'js/wasm'");
		expect(browserExecutionSource).toContain('wasm_exec.js');
	});
});
