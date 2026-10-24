import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import untar from '../../core/src/tar.js';
import { readBuffer } from '../../core/src/wasm.js';
import { gccAssetPaths, gccDigest, parseCrossGccManifest } from './manifest.js';
import { loadGccModuleFactory, type GccModuleFactory } from './module-loader.js';
import { gccCompilePlan, gccRelativePath } from './plan.js';
import type {
	CreateCrossGccCompilerOptions,
	CrossGccAssetName,
	CrossGccCompiler,
	CrossGccEmit,
	CrossGccStageResult,
	CrossGccTool
} from './types.js';

const tools = ['cc1', 'cc1plus', 'as', 'ld'] as const;
const encoder = new TextEncoder();
const maxDiagnosticsBytes = 4 * 1024 * 1024;

function validateOutput(bytes: Uint8Array, emit: CrossGccEmit) {
	if (emit === 'assembly') {
		if (!bytes.length) throw new Error('GCC produced empty assembly');
		new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return;
	}
	if (
		bytes.length < 64 ||
		bytes[0] !== 0x7f ||
		bytes[1] !== 69 ||
		bytes[2] !== 76 ||
		bytes[3] !== 70 ||
		bytes[4] !== 2 ||
		bytes[5] !== 1 ||
		bytes[6] !== 1
	)
		throw new Error('GCC did not produce little-endian ELF64');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		view.getUint16(18, true) !== 62 ||
		view.getUint16(16, true) !== (emit === 'object' ? 1 : 2) ||
		view.getUint32(20, true) !== 1 ||
		view.getUint16(52, true) !== 64
	)
		throw new Error('GCC produced an unexpected ELF target or output type');
	if (emit === 'executable') {
		const table = Number(view.getBigUint64(32, true)),
			size = view.getUint16(54, true),
			count = view.getUint16(56, true);
		if (
			!Number.isSafeInteger(table) ||
			size < 56 ||
			!count ||
			table < 64 ||
			table + size * count > bytes.length
		)
			throw new Error('GCC produced an invalid ELF program table');
		let loadable = false;
		for (let index = 0; index < count; index++) {
			const type = view.getUint32(table + index * size, true);
			if (type === 1) loadable = true;
			if (type === 3) throw new Error('GCC executable requests a dynamic interpreter');
		}
		if (!loadable) throw new Error('GCC executable has no loadable segment');
	}
}

/** Load the real GCC front ends and GNU binutils. No x86 execution API is provided. */
export async function createCrossGccCompiler(
	options: CreateCrossGccCompilerOptions
): Promise<CrossGccCompiler> {
	const manifestSha256 = gccDigest(options.manifestSha256);
	const manifestUrl = new URL(options.manifestUrl.toString());
	if (
		!['https:', 'http:'].includes(manifestUrl.protocol) ||
		manifestUrl.username ||
		manifestUrl.password ||
		manifestUrl.hash
	)
		throw new Error('GCC requires an HTTP(S) manifest URL');
	const maxAssetBytes = options.maxAssetBytes ?? 512 * 1024 * 1024;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1024)
		throw new Error('Invalid GCC asset byte limit');
	const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis),
		signal = options.signal;
	const manifestBytes = new Uint8Array(
		await readBuffer(manifestUrl.href, undefined, 1024 * 1024, signal, fetchImpl)
	);
	await verifyRuntimeAssetIntegrity({
		asset: manifestUrl.href,
		bytes: manifestBytes,
		expected: manifestSha256
	});
	const manifest = parseCrossGccManifest(
		JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
	);
	for (const asset of Object.values(manifest.assets))
		if (asset.bytes > maxAssetBytes)
			throw new Error('GCC asset exceeds the configured byte limit');
	const assets = new Map<CrossGccAssetName, Uint8Array>();
	await Promise.all(
		(Object.keys(gccAssetPaths) as CrossGccAssetName[]).map(async (name) => {
			const receipt = manifest.assets[name],
				url = new URL(receipt.path, manifestUrl).href;
			const bytes = new Uint8Array(
				await readBuffer(url, undefined, receipt.bytes, signal, fetchImpl)
			);
			await verifyRuntimeAssetIntegrity({ asset: url, bytes, expected: receipt });
			assets.set(name, bytes);
		})
	);
	signal?.throwIfAborted();
	const sysroot = new Map<string, Uint8Array>(),
		directories = new Set<string>();
	let extractedBytes = 0,
		entries = 0;
	function addPath(path: string, isDirectory: boolean) {
		const normalized = gccRelativePath(path.replace(/^\.\//u, '').replace(/\/$/u, ''));
		if (++entries > 100_000) throw new Error('GCC sysroot has too many entries');
		const absolute = `/sysroot/${normalized}`;
		if (sysroot.has(absolute) || (!isDirectory && directories.has(absolute)))
			throw new Error('Duplicate or conflicting GCC sysroot entry');
		const parts = absolute.split('/');
		parts.pop();
		while (parts.length > 1) {
			const parent = parts.join('/');
			if (sysroot.has(parent)) throw new Error('GCC sysroot file/directory collision');
			directories.add(parent);
			parts.pop();
		}
		if (isDirectory) directories.add(absolute);
		return absolute;
	}
	untar(assets.get('sysroot')!, {
		addDirectory(path) {
			if (path !== '.' && path !== './') addPath(path, true);
		},
		addFile(path, contents) {
			extractedBytes += contents.length;
			if (extractedBytes > maxAssetBytes)
				throw new Error('GCC sysroot exceeds its extraction limit');
			sysroot.set(addPath(path, false), contents);
		}
	});
	if (!sysroot.size) throw new Error('GCC sysroot is empty');
	const factories = new Map<
		CrossGccTool,
		{ factory: GccModuleFactory; revoke(): void; wasm: WebAssembly.Module }
	>();
	let disposed = false,
		active = false;
	function dispose() {
		disposed = true;
		for (const entry of factories.values()) entry.revoke();
		factories.clear();
		assets.clear();
		sysroot.clear();
		directories.clear();
	}
	try {
		for (const tool of tools) {
			signal?.throwIfAborted();
			const bytes = assets.get(`${tool}Wasm`)!;
			if (bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109)
				throw new Error(`GCC ${tool} host asset is not WebAssembly`);
			const wasm = await WebAssembly.compile(Uint8Array.from(bytes));
			const loader = await loadGccModuleFactory(assets.get(`${tool}Js`)!);
			factories.set(tool, { ...loader, wasm });
		}
		signal?.throwIfAborted();
	} catch (error) {
		dispose();
		throw error;
	}
	return {
		manifest,
		identity: Object.freeze({
			compiler: 'gcc',
			compilerVersion: '13.3.0',
			compilerHost: manifest.host,
			target: manifest.target,
			manifestSha256,
			sysrootSha256: manifest.assets.sysroot.sha256
		}),
		async compile(request) {
			if (disposed) throw new Error('GCC compiler is disposed');
			if (active) throw new Error('GCC compiler is busy');
			const plan = gccCompilePlan(request, manifest);
			active = true;
			const workspace = new Map(plan.files.map((file) => [file.path, file.contents]));
			const stages: CrossGccStageResult[] = [];
			let stdout = '',
				stderr = '',
				diagnosticBytes = 0;
			const print = (stream: 'stdout' | 'stderr') => (line: unknown) => {
				const value = `${String(line)}\n`;
				diagnosticBytes += encoder.encode(value).length;
				if (diagnosticBytes > maxDiagnosticsBytes)
					throw new Error('GCC diagnostics exceeded four MiB');
				if (stream === 'stdout') stdout += value;
				else stderr += value;
			};
			try {
				for (const stage of plan.stages) {
					if (disposed) throw new Error('GCC compiler is disposed');
					const loaded = factories.get(stage.tool)!;
					let exitCode = 0;
					const start = performance.now();
					const module = await loaded.factory({
						noInitialRun: true,
						noExitRuntime: false,
						wasmBinary: assets.get(`${stage.tool}Wasm`),
						instantiateWasm(
							imports: WebAssembly.Imports,
							receive: (
								instance: WebAssembly.Instance,
								module: WebAssembly.Module
							) => void
						) {
							const instance = new WebAssembly.Instance(loaded.wasm, imports);
							receive(instance, loaded.wasm);
							return instance.exports;
						},
						locateFile(path: string) {
							// Binutils' generated loader keeps its build-time *-new filename
							// after packaging. Both names resolve to the same pinned module.
							if (
								path === `${stage.tool}.wasm` ||
								((stage.tool === 'as' || stage.tool === 'ld') &&
									path === `${stage.tool}-new.wasm`)
							) {
								return new URL(
									manifest.assets[`${stage.tool}Wasm`].path,
									manifestUrl
								).href;
							}
							throw new Error(`GCC requested an unverified asset: ${path}`);
						},
						print: print('stdout'),
						printErr: print('stderr'),
						onExit(code: number) {
							exitCode = code;
						}
					});
					if (disposed) throw new Error('GCC compiler is disposed');
					if (
						!module?.FS ||
						typeof module.callMain !== 'function' ||
						!(module.HEAPU8 instanceof Uint8Array)
					)
						throw new Error(
							`GCC ${stage.tool} has an incompatible Emscripten interface`
						);
					module.FS.mkdirTree('/workspace');
					module.FS.mkdirTree('/tmp');
					for (const path of directories) module.FS.mkdirTree(path);
					for (const [path, bytes] of [...sysroot, ...workspace]) {
						module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
						module.FS.writeFile(path, bytes);
					}
					module.FS.chdir('/workspace');
					try {
						const status = module.callMain([...stage.argv]);
						if (typeof status === 'number') exitCode = status;
					} catch (error) {
						if (
							error &&
							typeof error === 'object' &&
							'name' in error &&
							error.name === 'ExitStatus' &&
							'status' in error &&
							Number.isSafeInteger(error.status)
						)
							exitCode = error.status as number;
						else throw error;
					}
					if (!Number.isSafeInteger(exitCode))
						throw new Error('GCC tool returned an invalid exit code');
					stages.push({
						tool: stage.tool,
						argv: [...stage.argv],
						exitCode,
						milliseconds: performance.now() - start,
						peakMemoryBytes: module.HEAPU8.byteLength
					});
					if (exitCode !== 0) return { exitCode, stdout, stderr, stages };
					const output = Uint8Array.from(module.FS.readFile(stage.output));
					validateOutput(
						output,
						stage.tool === 'as'
							? 'object'
							: stage.tool === 'ld'
								? 'executable'
								: 'assembly'
					);
					workspace.set(stage.output, output);
				}
				return {
					exitCode: 0,
					stdout,
					stderr,
					stages,
					artifact: {
						compiler: 'gcc',
						compilerHost: manifest.host,
						target: manifest.target,
						format:
							plan.emit === 'assembly'
								? 'assembly'
								: plan.emit === 'object'
									? 'elf-object'
									: 'elf-executable',
						fileName: plan.fileName,
						bytes: workspace.get(`/workspace/${plan.fileName}`)!,
						cpu: plan.cpu
					}
				};
			} finally {
				active = false;
			}
		},
		dispose
	};
}
