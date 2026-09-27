import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { compileRust } from '../src/compiler.js';
import {
	clearVerifiedRuntimeExecutableModuleUrls,
	configureVerifiedRuntimeExecutableModuleUrls
} from '../src/runtime-manifest.js';
import type { CompileWorkerRequest } from '../src/worker-protocol.js';
import { FakeWorker } from './helpers.js';

class TransferCapturingWorker extends FakeWorker {
	lastTransfer: Transferable[] | undefined;

	override postMessage(message: unknown, transfer?: Transferable[]) {
		this.lastTransfer = transfer;
		super.postMessage(message);
	}
}

afterEach(() => {
	clearVerifiedRuntimeExecutableModuleUrls();
});

describe('rustc module service compiler integration', () => {
	it('activates the private service from the canonical deployed rustc receipt', async () => {
		configureVerifiedRuntimeExecutableModuleUrls(
			{
				'https://example.test/wasm-rust/compiler.js?v=test':
					'blob:https://example.test/compiler'
			},
			'a'.repeat(64)
		);
		const worker = new TransferCapturingWorker((_message, currentWorker) => {
			currentWorker.emitMessage({ type: 'error', message: 'expected test stop' });
		});
		const deployedManifest = JSON.parse(
			readFileSync(
				new URL(
					'../../../static/wasm-rust/runtime/runtime-manifest.v3.json',
					import.meta.url
				),
				'utf8'
			)
		);
		deployedManifest.compiler.workerSharedOutputBytes = 1024;
		deployedManifest.compiler.workerSharedWorkspaceBytes = 1024;

		const result = await compileRust(
			{ code: 'fn main() {}' },
			{
				loadManifest: async () => deployedManifest,
				createWorker: () => worker,
				sleep: async () => Promise.resolve()
			}
		);

		expect(result.success).toBe(false);
		expect(worker.lastRequest, result.stderr).not.toBeNull();
		const posted = worker.lastRequest as CompileWorkerRequest;
		expect(posted.rustcModulePort).toBeInstanceOf(MessagePort);
		expect(worker.lastTransfer).toEqual([posted.rustcModulePort]);
	});
});
