import assert from 'node:assert/strict';
import test from 'node:test';
import { probeJavaLspSdk } from './probe-java-lsp-sdk.mjs';

test(
	'original Java LSP SDK: semantic RPC, verified asset reuse and real iframe lifecycle',
	{
		skip: process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP !== '1',
		timeout: 300000
	},
	async () => {
		const evidence = await probeJavaLspSdk();
		assert.equal(evidence.status, 'passed', evidence.error);
	}
);
