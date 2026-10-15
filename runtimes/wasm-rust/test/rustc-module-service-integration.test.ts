import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compileRust } from '../src/compiler.js';
import {
	clearVerifiedRuntimeExecutableModuleUrls,
	configureVerifiedRuntimeExecutableModuleUrls
} from '../src/runtime-manifest.js';
import type { CompileWorkerRequest } from '../src/worker-protocol.js';
import { FakeWorker, createRuntimeManifest } from './helpers.js';

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

function loadDeployedManifest() {
	const manifest = JSON.parse(
		readFileSync(
			new URL('../../../static/wasm-rust/runtime/runtime-manifest.v3.json', import.meta.url),
			'utf8'
		)
	);
	manifest.compiler.workerSharedOutputBytes = 1024;
	manifest.compiler.workerSharedWorkspaceBytes = 1024;
	return manifest;
}

function configureGraph() {
	configureVerifiedRuntimeExecutableModuleUrls(
		{
			'https://example.test/wasm-rust/compiler.js?v=test':
				'blob:https://example.test/compiler'
		},
		'a'.repeat(64)
	);
}

describe('rustc module service compiler integration', () => {
	it('activates the private service from the canonical deployed rustc receipt', async () => {
		configureGraph();
		const worker = new TransferCapturingWorker((_message, currentWorker) => {
			currentWorker.emitMessage({ type: 'error', message: 'expected test stop' });
		});
		const deployedManifest = loadDeployedManifest();

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

	it('forwards a host-owned private channel and closes it after compiler failure', async () => {
		configureGraph();
		const manifest = loadDeployedManifest();
		const channel = new MessageChannel();
		const close = vi.fn(() => {
			channel.port1.close();
			channel.port2.close();
		});
		const createRustcModuleService = vi.fn(() => ({ port: channel.port2, close }));
		const worker = new TransferCapturingWorker((_message, currentWorker) => {
			currentWorker.emitMessage({ type: 'error', message: 'expected test stop' });
		});
		const result = await compileRust(
			{ code: 'fn main() {}' },
			{
				loadManifest: async () => manifest,
				createWorker: () => worker,
				createRustcModuleService,
				sleep: async () => Promise.resolve()
			}
		);
		expect(result.success).toBe(false);
		expect(createRustcModuleService).toHaveBeenCalledWith(
			manifest.assetReceipts['wasm-rust/runtime/rustc/rustc.wasm.gz']
		);
		expect(worker.lastRequest?.rustcModulePort).toBe(channel.port2);
		expect(worker.lastTransfer).toEqual([channel.port2]);
		expect(close).toHaveBeenCalledTimes(1);
		expect(worker.terminated).toBe(true);
	});

	it('does not request a host module channel for an unverified executable topology', async () => {
		const createRustcModuleService = vi.fn();
		const worker = new TransferCapturingWorker((_message, currentWorker) => {
			currentWorker.emitMessage({ type: 'error', message: 'expected test stop' });
		});
		await compileRust(
			{ code: 'fn main() {}' },
			{
				loadManifest: async () => createRuntimeManifest(),
				createWorker: () => worker,
				createRustcModuleService,
				sleep: async () => Promise.resolve()
			}
		);
		expect(createRustcModuleService).not.toHaveBeenCalled();
		expect(worker.lastRequest?.rustcModulePort).toBeUndefined();
		expect(worker.lastTransfer).toEqual([]);
	});
});
