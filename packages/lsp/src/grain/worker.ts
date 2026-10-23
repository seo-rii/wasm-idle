import { SharedByteQueue, type SharedByteQueueDescriptor } from '@wasm-idle/llvm-core/debug';
import { fetchBoundedExternalAsset } from '../external-asset.js';
import { configureWorkerLanguageToolPersistentAssets } from '../persistent-assets.js';
import { GRAIN_LSP_PROFILE } from './profile.js';

interface GrainHost {
	process: unknown;
	require(name: string): {
		existsSync(path: string): boolean;
		mkdirSync(path: string): void;
		readSync: (
			fd: number,
			buffer: Uint8Array,
			offset: number,
			length: number,
			position?: number
		) => number;
	};
	exitCode(): number | null;
	isExit(error: unknown): boolean;
}
interface GrainHostModule {
	GRAIN_STDLIB_ROOT: string;
	GRAIN_STDLIB_SOURCE_MTIME_MS: number;
	GRAIN_STDLIB_OBJECT_MTIME_MS: number;
	readGrainStdlibPack(bytes: Uint8Array): Array<{ path: string; data: Uint8Array }>;
	createGrainCompilerHost(options: {
		files: unknown[];
		argv: string[];
		onStdout: (bytes: Uint8Array) => void;
		onStderr: (bytes: Uint8Array) => void;
	}): GrainHost;
}

const scope = globalThis as unknown as {
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};
let started = false;
scope.addEventListener('message', async ({ data }: MessageEvent) => {
	if (data?.type !== 'init' || started) return;
	started = true;
	let hostUrl: string | undefined;
	let serverUrl: string | undefined;
	let host: GrainHost | undefined;
	try {
		configureWorkerLanguageToolPersistentAssets(data.persistentAssets);
		const options = data.options as {
			baseUrl: string;
			stdin: SharedByteQueueDescriptor;
			workspaceFiles?: Array<{ path: string; content: string }>;
		};
		const stdin = new SharedByteQueue(options.stdin);
		const load = (name: 'host.mjs' | 'grainlsp.js.gz.bin' | 'stdlib.pack.gz.bin') =>
			fetchBoundedExternalAsset({
				url: new URL(name, options.baseUrl),
				label: `Grain LSP ${name}`,
				integrity: GRAIN_LSP_PROFILE.assets[name],
				maxBytes: 6 * 1024 * 1024,
				runtimeId: 'grain-lsp'
			});
		scope.postMessage({ type: 'progress', stage: 'grain-lsp-assets', loaded: 0, total: 1 });
		const [hostBytes, serverStorage, stdlibStorage] = await Promise.all([
			load('host.mjs'),
			load('grainlsp.js.gz.bin'),
			load('stdlib.pack.gz.bin')
		]);
		const unpack = async (bytes: Uint8Array, expected: { bytes: number; sha256: string }) => {
			const stream = new Blob([Uint8Array.from(bytes).buffer])
				.stream()
				.pipeThrough(new DecompressionStream('gzip'));
			const decoded = new Uint8Array(await new Response(stream).arrayBuffer());
			const digest = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', decoded)),
				(value) => value.toString(16).padStart(2, '0')
			).join('');
			if (decoded.length !== expected.bytes || digest !== expected.sha256)
				throw new Error('Grain LSP decompressed asset failed integrity verification');
			return decoded;
		};
		const [serverBytes, stdlibBytes] = await Promise.all([
			unpack(serverStorage, GRAIN_LSP_PROFILE.server),
			unpack(stdlibStorage, GRAIN_LSP_PROFILE.stdlib)
		]);
		hostUrl = URL.createObjectURL(new Blob([hostBytes], { type: 'text/javascript' }));
		const runtime = (await import(/* @vite-ignore */ hostUrl)) as GrainHostModule;
		const files = runtime.readGrainStdlibPack(stdlibBytes).map(({ path, data }) => ({
			path: `${runtime.GRAIN_STDLIB_ROOT}/${path}`,
			data,
			mtimeMs: path.endsWith('.gro')
				? runtime.GRAIN_STDLIB_OBJECT_MTIME_MS
				: runtime.GRAIN_STDLIB_SOURCE_MTIME_MS
		}));
		for (const file of options.workspaceFiles || [])
			files.push({
				path: `/workspace/${file.path}`,
				data: new TextEncoder().encode(file.content),
				mtimeMs: runtime.GRAIN_STDLIB_SOURCE_MTIME_MS
			});
		host = runtime.createGrainCompilerHost({
			files,
			argv: ['--stdlib', runtime.GRAIN_STDLIB_ROOT, '--no-color'],
			onStdout: (bytes) =>
				scope.postMessage({ type: 'stdout', bytes }, [bytes.buffer as ArrayBuffer]),
			onStderr: (bytes) =>
				scope.postMessage({ type: 'stderr', text: new TextDecoder().decode(bytes) })
		});
		const fs = host.require('node:fs');
		if (!fs.existsSync('/workspace')) fs.mkdirSync('/workspace');
		const read = fs.readSync;
		let ready = false;
		fs.readSync = (fd, buffer, offset, length, position) => {
			if (fd !== 0) return read(fd, buffer, offset, length, position);
			if (!ready) {
				ready = true;
				scope.postMessage({ type: 'ready' });
			}
			return stdin.readBlocking(buffer.subarray(offset, offset + length));
		};
		Object.assign(globalThis, { process: host.process, require: host.require });
		serverUrl = URL.createObjectURL(new Blob([serverBytes], { type: 'text/javascript' }));
		await import(/* @vite-ignore */ serverUrl);
		scope.postMessage({ type: 'exit', code: host.exitCode() ?? 0 });
	} catch (error) {
		if (host?.isExit(error)) scope.postMessage({ type: 'exit', code: host.exitCode() });
		else
			scope.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error)
			});
	} finally {
		if (hostUrl) URL.revokeObjectURL(hostUrl);
		if (serverUrl) URL.revokeObjectURL(serverUrl);
	}
});
