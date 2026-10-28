import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import untar from '@wasm-idle/core/runtime-tar';
import { readBuffer } from '@wasm-idle/core/runtime-asset-loader';
import { gccAssetPaths, gccDigest, parseCrossGccManifest } from './manifest.js';
import { loadGccModuleFactory, type GccModuleFactory } from './module-loader.js';
import { gccCompilePlan, gccRelativePath } from './plan.js';
import { gccSysrootTree, mountGccSysroot, type GccSysrootDirectory } from './sysroot-fs.js';
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
const pchDirectory = '/pch',
	pchPath = `${pchDirectory}/bits/stdc++.h.gch`;

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
	// readBuffer caches by fetch identity before callers verify SHA-256. Scope that
	// cache to this initialization, including when a caller reuses a custom fetch,
	// so a retry or repinned bundle cannot inherit rejected or obsolete bytes.
	const fetchImpl = options.fetchImpl?.bind(undefined) ?? globalThis.fetch?.bind(globalThis),
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
	const sysrootTree = gccSysrootTree(sysroot, directories, '/sysroot');
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
		sysrootTree.clear();
		precompiled = undefined;
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
	let precompiled: { flags: readonly string[]; bytes: Uint8Array } | undefined;
	/** Each stage gets a fresh module and workspace; the first failing tool ends the run. */
	async function run(
		stages: readonly {
			tool: CrossGccTool;
			argv: readonly string[];
			output: string;
			precompiledHeader?: Uint8Array;
		}[],
		files: readonly { path: string; contents: Uint8Array }[]
	) {
		if (disposed) throw new Error('GCC compiler is disposed');
		if (active) throw new Error('GCC compiler is busy');
		active = true;
		const workspace = new Map(files.map((file) => [file.path, file.contents]));
		const results: CrossGccStageResult[] = [];
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
			for (const stage of stages) {
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
							return new URL(manifest.assets[`${stage.tool}Wasm`].path, manifestUrl)
								.href;
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
					typeof module.FS.mount !== 'function' ||
					typeof module.FS.createNode !== 'function' ||
					typeof module.callMain !== 'function' ||
					!(module.HEAPU8 instanceof Uint8Array)
				)
					throw new Error(`GCC ${stage.tool} has an incompatible Emscripten interface`);
				module.FS.mkdirTree('/workspace');
				module.FS.mkdirTree('/tmp');
				if (stage.precompiledHeader || stage.output === pchPath)
					module.FS.mkdirTree(`${pchDirectory}/bits`);
				mountGccSysroot(module.FS, sysrootTree, '/sysroot');
				for (const [path, bytes] of workspace) {
					module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
					module.FS.writeFile(path, bytes);
				}
				// GCC maps a PCH privately, so the shared bytes are copied, never modified.
				if (stage.precompiledHeader)
					module.FS.writeFile(pchPath, stage.precompiledHeader, { canOwn: true });
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
				results.push({
					tool: stage.tool,
					argv: [...stage.argv],
					exitCode,
					milliseconds: performance.now() - start,
					peakMemoryBytes: module.HEAPU8.byteLength
				});
				if (exitCode !== 0) return { exitCode, stdout, stderr, stages: results };
				const output = Uint8Array.from(module.FS.readFile(stage.output));
				if (stage.output !== pchPath)
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
			return { exitCode: 0, stdout, stderr, stages: results, workspace };
		} catch (error) {
			// Worker transport forwards only the error message. Preserve diagnostics
			// printed before an unexpected host abort, without turning it into a
			// normal tool exit or allowing an artifact from a previous request.
			throw new Error(
				[
					`GCC compilation failed: ${error instanceof Error ? error.message : String(error)}`,
					stdout && `GCC stdout:\n${stdout}`,
					stderr && `GCC stderr:\n${stderr}`
				]
					.filter(Boolean)
					.join('\n'),
				{ cause: error }
			);
		} finally {
			active = false;
		}
	}
	return {
		manifest,
		identity: Object.freeze({
			compiler: 'gcc',
			compilerVersion: '16.2.0',
			compilerHost: manifest.host,
			target: manifest.target,
			manifestSha256,
			sysrootSha256: manifest.assets.sysroot.sha256
		}),
		async compile(request) {
			if (disposed) throw new Error('GCC compiler is disposed');
			if (active) throw new Error('GCC compiler is busy');
			const plan = gccCompilePlan(request, manifest);
			// GCC loads the header only where it is valid; otherwise it parses the source.
			const pch =
				precompiled &&
				plan.frontEndFlags.length === precompiled.flags.length &&
				plan.frontEndFlags.every((flag, index) => flag === precompiled!.flags[index])
					? precompiled
					: undefined;
			const result = await run(
				plan.stages.map((stage) => {
					if (!pch || stage.tool !== 'cc1plus') return stage;
					const include = stage.argv.indexOf('-isystem');
					return {
						...stage,
						argv: [
							...stage.argv.slice(0, include),
							'-isystem',
							pchDirectory,
							...stage.argv.slice(include)
						],
						precompiledHeader: pch.bytes
					};
				}),
				plan.files
			);
			if (!result.workspace) return result;
			const { workspace, ...completed } = result;
			return {
				...completed,
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
		},
		async precompileHeader(request = {}) {
			if (disposed) throw new Error('GCC compiler is disposed');
			if (active) throw new Error('GCC compiler is busy');
			if (!manifest.capabilities.precompiledHeaders)
				throw new Error('This GCC bundle cannot load precompiled headers');
			if (
				!request ||
				typeof request !== 'object' ||
				Object.keys(request).some(
					(key) => !['cpu', 'optimization', 'standard'].includes(key)
				)
			)
				throw new Error('Unsupported GCC precompiled header option');
			const { frontEndFlags } = gccCompilePlan(
				{ ...request, code: '', language: 'cpp', emit: 'assembly' },
				manifest
			);
			// Precompile the copy GCC would find first, exactly as #include <bits/stdc++.h> does.
			const header = frontEndFlags
				.flatMap((flag, index) =>
					frontEndFlags[index - 1] === '-isystem' ? [`${flag}/bits/stdc++.h`] : []
				)
				.find((path) => {
					let entry: GccSysrootDirectory | Uint8Array | undefined = sysrootTree;
					for (const name of path.slice('/sysroot/'.length).split('/'))
						entry = entry instanceof Map ? entry.get(name) : undefined;
					return entry instanceof Uint8Array;
				});
			if (!header) throw new Error('GCC sysroot has no bits/stdc++.h');
			precompiled = undefined;
			const result = await run(
				[
					{
						tool: 'cc1plus',
						argv: [
							...frontEndFlags,
							header,
							'-o',
							'/workspace/stdc++.h.s',
							'--output-pch',
							pchPath
						],
						output: pchPath
					}
				],
				[]
			);
			if (!result.workspace) return result;
			const { workspace, ...completed } = result;
			const bytes = workspace.get(pchPath)!;
			precompiled = { flags: frontEndFlags, bytes };
			return { ...completed, bytes: bytes.byteLength };
		},
		dispose
	};
}
