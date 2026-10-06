// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { computeReScriptRuntimeFingerprint } from '../../../scripts/sync-wasm-rescript.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import { RUNTIME_ASSET_LOCK } from '../../../packages/core/src/runtime-asset-lock.generated';
import { StaticStdinRingHost } from './staticStdinRing';
import {
	WASM_RESCRIPT_ASSET_VERSION,
	WASM_RESCRIPT_RUNNER_RECEIPT,
	WASM_RESCRIPT_RUNTIME_PROFILE
} from './wasmReScriptVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-rescript-runner-worker.js',
	import.meta.url
);
const staticRuntimeUrl = new URL('../../../static/wasm-rescript/', import.meta.url);

const stdinProgram = `@module("fs") external readLineSync: int => string = "readLineSync"

Console.log("value?")
let n = readLineSync(0)->Int.fromString->Option.getOr(0)
Console.log(\`main=\${Int.toString(n + 5)}\`)
`;

let runtimeBytesPromise: Promise<{ manifestBytes: Uint8Array; compilerBytes: Uint8Array }> | null =
	null;

function loadRuntimeBytes() {
	runtimeBytesPromise ??= (async () => {
		const manifestBytes = await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl));
		const compressed = await readFile(new URL('compiler.js.gz.bin', staticRuntimeUrl));
		return {
			manifestBytes: Uint8Array.from(manifestBytes),
			compilerBytes: Uint8Array.from(gunzipSync(compressed))
		};
	})();
	return runtimeBytesPromise;
}

async function createHarnessWorker(options: { closeStdinBeforeWait?: boolean } = {}) {
	const workerSource = await readFile(workerSourceUrl, 'utf8');
	// Runs the worker inside a browser-like vm realm (no Node `process`/`require`) so the
	// js_of_ocaml compiler takes its browser path, exactly as in a dedicated Worker.
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
class FakeBlob {
  constructor(parts) { this.parts = parts; }
}
const blobs = new Map();
let blobCounter = 0;
const context = vm.createContext({
  console,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  SharedArrayBuffer,
  setTimeout,
  clearTimeout,
  Blob: FakeBlob,
  fetch: (...args) => {
    parentPort.postMessage({ harnessFetch: args.map(String) });
    throw new Error('worker network access is forbidden');
  }
});
context.self = context;
context.postMessage = (message) => parentPort.postMessage(message);
if (${Boolean(options.closeStdinBeforeWait)}) {
  const nativeAtomics = vm.runInContext('Atomics', context);
  const atomics = Object.create(nativeAtomics);
  let closed = false;
  atomics.wait = (control, index, expected, timeout) => {
    if (!closed && index === 0) {
      closed = true;
      nativeAtomics.store(control, 2, 1);
      // Close happens after the worker's EOF check, before it starts waiting.
      nativeAtomics.notify(control, 0);
      parentPort.postMessage({ harnessStdinClosedBeforeWait: true });
    }
    return nativeAtomics.wait(control, index, expected, timeout);
  };
  context.Atomics = atomics;
}
context.URL = {
  createObjectURL(blob) {
    const url = 'blob:wasm-rescript-fixture-' + ++blobCounter;
    blobs.set(url, blob);
    return url;
  },
  revokeObjectURL(url) {
    blobs.delete(url);
    parentPort.postMessage({ harnessBlobRevoked: url });
  }
};
context.importScripts = (url) => {
  parentPort.postMessage({ harnessImported: url });
  const blob = blobs.get(url);
  const text = blob.parts.map((part) => typeof part === 'string' ? part : new TextDecoder().decode(part)).join('');
  vm.runInContext(text, context);
};
vm.runInContext(${JSON.stringify(workerSource)}, context);
parentPort.on('message', (data) => context.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function runHarness(
	request: Record<string, unknown>,
	onMessage?: (message: any) => void,
	harnessOptions: { closeStdinBeforeWait?: boolean; timeoutMs?: number } = {}
) {
	const worker = await createHarnessWorker(harnessOptions);
	const messages: any[] = [];
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			if (harnessOptions.timeoutMs !== undefined) {
				timeout = setTimeout(
					() => reject(new Error('ReScript worker did not finish after stdin EOF')),
					harnessOptions.timeoutMs
				);
			}
			worker.on('message', (message) => {
				messages.push(message);
				try {
					onMessage?.(message);
				} catch (error) {
					reject(error);
					return;
				}
				if (message?.results !== undefined || message?.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`ReScript harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		await worker.terminate();
	}
}

async function runtimePreflight(overrides: Record<string, unknown> = {}) {
	const { manifestBytes, compilerBytes } = await loadRuntimeBytes();
	return {
		protocol: 'wasm-idle-rescript-preflight',
		protocolVersion: 1,
		profileId: WASM_RESCRIPT_RUNTIME_PROFILE.profileId,
		sourceRevision: WASM_RESCRIPT_RUNTIME_PROFILE.sourceRevision,
		manifestFingerprint: WASM_RESCRIPT_ASSET_VERSION,
		manifestBytes: Uint8Array.from(manifestBytes),
		compilerBytes: Uint8Array.from(compilerBytes),
		...overrides
	};
}

async function runRequest(overrides: Record<string, unknown> = {}) {
	return {
		manifestFingerprint: WASM_RESCRIPT_ASSET_VERSION,
		maxAssetBytes: 16 * 1024 * 1024,
		code: stdinProgram,
		stdin: '68\n',
		activePath: 'Main.res',
		runtimePreflight: await runtimePreflight(),
		...overrides
	};
}

const outputText = (messages: any[]) =>
	messages
		.filter((message) => typeof message?.output === 'string' && message.stream !== 'stderr')
		.map((message) => message.output)
		.join('');

describe('ReScript runner worker', () => {
	it('keeps the deployed receipts, runner pin, input lock, and profile current', async () => {
		const source = await readFile(workerSourceUrl, 'utf8');
		expect(await readFile(new URL('runner-worker.js', staticRuntimeUrl), 'utf8')).toBe(source);
		expect(Buffer.byteLength(source)).toBe(WASM_RESCRIPT_RUNNER_RECEIPT.bytes);
		expect(createHash('sha256').update(source).digest('hex')).toBe(
			WASM_RESCRIPT_RUNNER_RECEIPT.sha256
		);
		expect(RUNTIME_ASSET_LOCK.assets['wasm-rescript/runner-worker.js']).toMatchObject(
			WASM_RESCRIPT_RUNNER_RECEIPT
		);
		expect((await readdir(staticRuntimeUrl)).sort()).toEqual([
			'LICENSE.txt',
			'compiler.js.gz.bin',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json'
		]);
		const manifestBytes = await readFile(new URL('runtime-manifest.v1.json', staticRuntimeUrl));
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		const inputLock = JSON.parse(
			await readFile(
				new URL('../../../scripts/wasm-rescript-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		const compressed = await readFile(new URL('compiler.js.gz.bin', staticRuntimeUrl));
		const bundle = gunzipSync(compressed);
		expect(bundle.byteLength).toBe(inputLock.bundle.bytes);
		expect(createHash('sha256').update(bundle).digest('hex')).toBe(inputLock.bundle.sha256);
		expect(manifest.assets[0]).toEqual({
			path: 'compiler.js',
			mediaType: 'text/javascript',
			size: inputLock.bundle.bytes,
			sha256: inputLock.bundle.sha256
		});
		expect(manifest.storage[0]).toMatchObject({
			path: 'compiler.js.gz.bin',
			size: compressed.byteLength,
			sha256: createHash('sha256').update(compressed).digest('hex')
		});
		for (const receipt of [manifest.license, manifest.metadata]) {
			const bytes = await readFile(new URL(receipt.path, staticRuntimeUrl));
			expect(bytes.byteLength).toBe(receipt.size);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(receipt.sha256);
		}
		const metadata = JSON.parse(
			await readFile(new URL('runtime-build.json', staticRuntimeUrl), 'utf8')
		);
		expect(metadata.components).toEqual(inputLock.components);
		expect(metadata.source).toEqual(inputLock.source);
		expect(manifest.license.spdx).toBe('LGPL-3.0-or-later AND MIT');
		expect(computeReScriptRuntimeFingerprint(manifest)).toBe(WASM_RESCRIPT_ASSET_VERSION);
		expect(WASM_RESCRIPT_RUNTIME_PROFILE).toEqual({
			profileId: manifest.profileId,
			sourceRevision: manifest.source.revision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: manifestBytes.byteLength,
				sha256: createHash('sha256').update(manifestBytes).digest('hex')
			},
			compilerReceipt: {
				bytes: manifest.storage[0].size,
				sha256: manifest.storage[0].sha256,
				uncompressedBytes: manifest.assets[0].size,
				uncompressedSha256: manifest.assets[0].sha256
			}
		});
	});

	it('compiles with the real ReScript compiler and connects buffered stdin to stdout', async () => {
		const messages = await runHarness(await runRequest());

		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('value?\nmain=73\n');
		expect(messages.some((message) => message.harnessFetch)).toBe(false);
		expect(messages).toContainEqual(
			expect.objectContaining({
				harnessImported: expect.stringMatching(/^blob:wasm-rescript-/u)
			})
		);
	}, 60_000);

	it('runs the editor default program against stdin', async () => {
		const messages = await runHarness(
			await runRequest({ code: editorDefaults.rescript, stdin: '10\n' })
		);

		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('fibonacci=92\n');
		expect(messages.some((message) => message.diagnostic)).toBe(false);
	}, 60_000);

	it('streams the prompt before readLineSync blocks on streaming stdin', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 64 });
		let supplied = false;
		const messages = await runHarness(
			await runRequest({ stdin: '', stdinChannel: stdin.descriptor }),
			(message) => {
				if (!supplied && message?.output?.includes('value?')) {
					supplied = true;
					setTimeout(() => {
						stdin.enqueue('68\r\n');
						stdin.close();
					}, 10);
				}
			}
		);

		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('value?\nmain=73\n');
		expect(messages.some((message) => message?.type === 'stdin-request')).toBe(true);
	}, 60_000);

	it('finishes a streaming read when the EOF notification races the wait', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 64 });
		const messages = await runHarness(
			await runRequest({
				code: `@module("fs") external readFileSync: (int, string) => string = "readFileSync"
Console.log("eof=" ++ readFileSync(0, "utf8"))`,
				stdin: '',
				stdinChannel: stdin.descriptor
			}),
			undefined,
			{ closeStdinBeforeWait: true, timeoutMs: 5_000 }
		);

		expect(messages).toContainEqual({ harnessStdinClosedBeforeWait: true });
		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('eof=\n');
	}, 60_000);

	it('loads upstream stdlib runtime modules and reads all stdin through fs.readFileSync', async () => {
		const code = `@module("fs") external readFileSync: (int, string) => string = "readFileSync"

let total =
  readFileSync(0, "utf8")
  ->String.split("\\n")
  ->Array.filterMap(line => line->String.trim->Int.fromString)
  ->Belt.List.fromArray
  ->Belt.List.reduce(0, (sum, value) => sum + value)
Console.log2("sum", total)
`;
		const messages = await runHarness(await runRequest({ code, stdin: '1\n2\n3\n' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('sum 6\n');
	}, 60_000);

	it('checks stdin existence without consuming the buffered input', async () => {
		const code = `@module("fs") external existsSync: string => bool = "existsSync"
@module("fs") external readFileSync: (int, string) => string = "readFileSync"
Console.log(existsSync("/dev/stdin"))
Console.log(readFileSync(0, "utf8"))`;
		const messages = await runHarness(await runRequest({ code, stdin: 'input' }));

		expect(messages.at(-1)).toEqual({ results: true });
		expect(outputText(messages)).toBe('true\ninput\n');
	}, 60_000);

	it('reports compile errors as editor diagnostics without running the program', async () => {
		const messages = await runHarness(
			await runRequest({ code: 'Console.log("ok")\nlet x: int = "a"\n' })
		);

		expect(messages).toContainEqual({
			diagnostic: expect.objectContaining({
				fileName: 'Main.res',
				lineNumber: 2,
				columnNumber: 14,
				endColumnNumber: 17,
				severity: 'error',
				message: expect.stringContaining("But it's expected to have type: int")
			})
		});
		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('Main.res:2:14-16')
		});
		expect(outputText(messages)).toBe('');
	}, 60_000);

	it('surfaces uncaught ReScript exceptions as runtime failures', async () => {
		const messages = await runHarness(
			await runRequest({ code: 'Console.log("before")\nthrow(Not_found)\n' })
		);

		expect(outputText(messages)).toBe('before\n');
		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('Uncaught ReScript exception Not_found')
		});
	}, 60_000);

	it.each([
		['missing payload', undefined, 'requires a valid host-preflighted asset payload'],
		[
			'extra payload field',
			{ unexpected: true },
			'requires a valid host-preflighted asset payload'
		],
		[
			'protocol drift',
			{ protocolVersion: 2 },
			'requires a valid host-preflighted asset payload'
		],
		[
			'profile drift',
			{ profileId: 'rescript-12.3.1-other' },
			'profile, source, or build metadata is invalid'
		],
		[
			'manifest fingerprint mutation',
			{ manifestBytes: Uint8Array.from(Buffer.from('{')) },
			'not valid UTF-8 JSON'
		]
	])(
		'rejects %s before evaluating the compiler',
		async (_label, overrides, error) => {
			const request = await runRequest();
			const messages = await runHarness({
				...request,
				runtimePreflight:
					overrides === undefined ? undefined : await runtimePreflight(overrides)
			});

			expect(messages.at(-1)).toEqual({ error: expect.stringContaining(error) });
			expect(messages.some((message) => message.harnessImported)).toBe(false);
		},
		60_000
	);

	it('rejects corrupted compiler bytes before evaluation', async () => {
		const { compilerBytes } = await loadRuntimeBytes();
		const corrupted = Uint8Array.from(compilerBytes);
		corrupted[corrupted.length - 2] ^= 1;
		const messages = await runHarness(
			await runRequest({
				runtimePreflight: await runtimePreflight({ compilerBytes: corrupted })
			})
		);

		expect(messages.at(-1)).toEqual({
			error: expect.stringContaining('failed size/SHA-256 verification')
		});
		expect(messages.some((message) => message.harnessImported)).toBe(false);
	}, 60_000);
});
