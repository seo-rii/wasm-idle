import { SharedByteQueue, type SharedByteQueueDescriptor } from '@wasm-idle/llvm-core/debug';
import { fetchBoundedExternalAsset } from '../external-asset.js';
import { configureWorkerLanguageToolPersistentAssets } from '../persistent-assets.js';
import { configureNimFileSystem, type NimFileSystem } from './platform.js';
import { NIM_LSP_PROFILE } from './profile.js';

interface WorkerScope {
	postMessage(message: unknown, transfer?: Transferable[]): void;
}
interface NimModule {
	FS: NimFileSystem;
	callMain(args: string[]): void;
}

export async function startNimLanguageServerWorker(data: any, scope: WorkerScope) {
	let scriptUrl: string | undefined;
	try {
		configureWorkerLanguageToolPersistentAssets(data.persistentAssets);
		const options = data.options as {
			baseUrl: string;
			stdin: SharedByteQueueDescriptor;
			workspaceFiles: Array<{ path: string; content: string }>;
		};
		const queue = new SharedByteQueue(options.stdin);
		const load = async (
			name: 'nimlsp.mjs.gz.bin' | 'nimlsp.wasm.gz.bin' | 'stdlib.json.gz.bin'
		) => {
			const stored = await fetchBoundedExternalAsset({
				url: new URL(name, options.baseUrl),
				label: `Nim LSP ${name}`,
				integrity: NIM_LSP_PROFILE.assets[name],
				maxBytes: 8 * 1024 * 1024,
				runtimeId: 'nim-lsp'
			});
			const stream = new Blob([Uint8Array.from(stored).buffer])
				.stream()
				.pipeThrough(new DecompressionStream('gzip'));
			const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
			const digest = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				(value) => value.toString(16).padStart(2, '0')
			).join('');
			const expected = NIM_LSP_PROFILE.logical[name];
			if (bytes.length !== expected.bytes || digest !== expected.sha256)
				throw new Error('Nim LSP decompressed asset failed integrity verification');
			return bytes;
		};
		scope.postMessage({ type: 'progress', stage: 'nim-lsp-assets', loaded: 0, total: 3 });
		const [script, wasm, packed] = await Promise.all([
			load('nimlsp.mjs.gz.bin'),
			load('nimlsp.wasm.gz.bin'),
			load('stdlib.json.gz.bin')
		]);
		const standardLibrary = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(packed)
		);
		if (
			standardLibrary.format !== 'wasm-idle-nim-lsp-stdlib-v1' ||
			!Array.isArray(standardLibrary.files)
		)
			throw new Error('Invalid Nim LSP standard library pack');
		const files = standardLibrary.files.map(
			({ path, base64 }: { path: string; base64: string }) => ({
				path: `/nim/${path}`,
				data: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
			})
		);
		for (const file of options.workspaceFiles)
			files.push({
				path: `/workspace/${file.path}`,
				data: new TextEncoder().encode(file.content)
			});
		scriptUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
		const runtime = await import(/* @vite-ignore */ scriptUrl);
		let exitCode: number | null = null;
		const module = (await runtime.default({
			noInitialRun: true,
			wasmBinary: wasm,
			locateFile(name: string) {
				if (name !== 'nimlsp.wasm') throw new Error(`Unexpected Nim LSP asset ${name}`);
				return new URL('nimlsp.wasm.gz.bin', options.baseUrl).href;
			},
			onExit(code: number) {
				exitCode = code;
			},
			printErr(text: string) {
				scope.postMessage({ type: 'stderr', text });
			}
		})) as NimModule;
		let ready = false;
		configureNimFileSystem({
			fs: module.FS,
			wasm,
			files,
			read(buffer) {
				if (!ready) {
					ready = true;
					scope.postMessage({ type: 'ready' });
				}
				return queue.readBlocking(buffer);
			},
			stdout(bytes) {
				scope.postMessage({ type: 'stdout', bytes }, [bytes.buffer as ArrayBuffer]);
			},
			stderr(bytes) {
				scope.postMessage({ type: 'stderr', text: new TextDecoder().decode(bytes) });
			}
		});
		module.callMain(['/nim']);
		if (exitCode === null) throw new Error('Nim LSP returned without an upstream exit status');
		scope.postMessage({ type: 'exit', code: exitCode });
	} catch (error) {
		scope.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined
		});
	} finally {
		if (scriptUrl) URL.revokeObjectURL(scriptUrl);
	}
}
