import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { commandFree, commandRun, fromFile, init, packageFree, verifyBashRuntimePreflightPayload } =
	vi.hoisted(() => ({
		commandFree: vi.fn(),
		commandRun: vi.fn(),
		fromFile: vi.fn(),
		init: vi.fn(async () => {}),
		packageFree: vi.fn(),
		verifyBashRuntimePreflightPayload: vi.fn()
	}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyBashRuntimePreflightPayload
}));

import {
	BASH_PREFLIGHT_PROTOCOL,
	BASH_PREFLIGHT_PROTOCOL_VERSION,
	type BashRuntimePreflightPayload
} from '@wasm-idle/core';
import Bash from './worker/bashRuntime';
import { WASM_BASH_RUNTIME_PROFILE } from './wasmBashVersion';

function createRuntimePreflight(): BashRuntimePreflightPayload {
	return Object.freeze({
		protocol: BASH_PREFLIGHT_PROTOCOL,
		protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
		profileId: WASM_BASH_RUNTIME_PROFILE.profileId,
		bashPackageVersion: WASM_BASH_RUNTIME_PROFILE.bashPackageVersion,
		bashSourceRevision: WASM_BASH_RUNTIME_PROFILE.bashSourceRevision,
		wasmerSdkVersion: WASM_BASH_RUNTIME_PROFILE.wasmerSdkVersion,
		wasmerSdkPackageIntegrity: WASM_BASH_RUNTIME_PROFILE.wasmerSdkPackageIntegrity,
		manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint,
		manifestBytes: new Uint8Array([1]),
		sdkJavaScriptBytes: new Uint8Array([2]),
		wasmerWasmBytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
		webcBytes: new Uint8Array([0, 119, 101, 98, 99, 48, 48, 51])
	});
}

const byteStream = (text: string) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});

describe('Bash execution output limits', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		init.mockResolvedValue(undefined);
		verifyBashRuntimePreflightPayload.mockImplementation(async (value) => value);
		fromFile.mockResolvedValue({
			entrypoint: { run: commandRun, free: commandFree },
			free: packageFree
		});
		let objectUrlId = 0;
		vi.spyOn(URL, 'createObjectURL').mockImplementation(
			() => `blob:http://localhost:3000/bash-limits-${++objectUrlId}`
		);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shares one UTF-8 byte quota across stdout and stderr before cleanup reentry', async () => {
		let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
		let stderrController: ReadableStreamDefaultController<Uint8Array> | undefined;
		let resolveWait: ((value: { ok: boolean; code: number }) => void) | undefined;
		const stdoutCancel = vi.fn();
		const stderrCancel = vi.fn();
		const wait = vi.fn(
			() =>
				new Promise<{ ok: boolean; code: number }>((resolve) => {
					resolveWait = resolve;
				})
		);
		commandRun
			.mockResolvedValueOnce({
				stdin: undefined,
				stdout: new ReadableStream<Uint8Array>({
					start(controller) {
						stdoutController = controller;
					},
					cancel: stdoutCancel
				}),
				stderr: new ReadableStream<Uint8Array>({
					start(controller) {
						stderrController = controller;
					},
					cancel: stderrCancel
				}),
				wait,
				free: vi.fn()
			})
			.mockResolvedValueOnce({
				stdin: undefined,
				stdout: byteStream('retry\n'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: vi.fn()
			});
		const Runtime = vi.fn(function Runtime() {
			return { free: vi.fn() };
		});
		const sandbox = new Bash({
			importVerifiedSdkModule: async () => ({ init, Runtime, Wasmer: { fromFile } })
		});
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.loadVerified(createRuntimePreflight());
		let replacement: Promise<boolean | string> | undefined;
		let listenerRemovals = 0;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				listenerRemovals += 1;
				if (listenerRemovals === 2) replacement = sandbox.run('printf retry', false);
			}
		} as unknown as AbortSignal;
		const running = sandbox.run('printf bounded', false, true, undefined, [], {
			signal,
			stdin: 'fixed input\n',
			limits: { maxOutputBytes: 5 }
		});
		sandbox.write('discard after quota failure\n');
		sandbox.eof();
		await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());

		stdoutController?.enqueue(new TextEncoder().encode('abc'));
		await vi.waitFor(() => expect(output).toHaveBeenCalledWith('abc'));
		stderrController?.enqueue(new TextEncoder().encode('éé'));
		const limitError = await running.catch((error) => error);

		expect(limitError).toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'BASH',
			actual: 7,
			limit: 5
		});
		expect(output).not.toHaveBeenCalledWith('éé');
		await vi.waitFor(() => expect(stdoutCancel).toHaveBeenCalledWith(limitError));
		await vi.waitFor(() => expect(stderrCancel).toHaveBeenCalledWith(limitError));
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		resolveWait?.({ ok: true, code: 0 });
		await expect(replacement).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('retry\n');
		expect(commandRun).toHaveBeenCalledTimes(2);
	});
});
