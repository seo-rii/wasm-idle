import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Directory, File, OpenDirectory, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';

import { loadTinyGoUpstreamToolchainAssets } from '../src/upstream-assets.ts';
import {
	TINYGO_ROOT_PATH,
	TINYGO_RUNTIME_CLOSURE_FORMAT,
	TINYGO_RUNTIME_PROFILE_ID,
	TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT,
	TINYGO_UPSTREAM_COMPILER_PACKAGES,
	TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS,
	TINYGO_UPSTREAM_PACKAGE_GRAPH_PACKAGES,
	TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS,
	TINYGO_WORKSPACE_PATH,
	computeTinyGoRuntimeProfileFingerprint,
	normalizeTinyGoPackageJSON,
	sha256TinyGoBytes,
	validateTinyGoPackageJSON,
	verifyTinyGoUpstreamAssetSet,
	type TinyGoRuntimeClosure
} from '../src/upstream-contract.ts';
import {
	createBinaryenTinyGoOptimizer,
	selectTinyGoOfflineModuleMode,
	validateTinyGoLinkPlan,
	validateTinyGoLinkPlanV2,
	validateTinyGoLinkPlanV3,
	validateTinyGoLinkPlanV4,
	validateTinyGoLinkPlanV5,
	validateTinyGoLinkPlanV6,
	type TinyGoBinaryenLike
} from '../src/upstream-runtime.ts';
import {
	assertTinyGoFinalWasmModule,
	assertTinyGoLLVMBitcodeEnvelope,
	assertTinyGoRelocatableWasmObject
} from '../src/upstream-binary.ts';
import {
	addTinyGoVfsFile,
	extractTinyGoRootTar,
	hasTinyGoVfsPath,
	readTinyGoVfsFile,
	type TinyGoWasiDirectoryContents
} from '../src/upstream-vfs.ts';

function writeTarString(header: Uint8Array, offset: number, length: number, value: string) {
	const bytes = new TextEncoder().encode(value);
	assert.ok(bytes.byteLength <= length);
	header.set(bytes, offset);
}

function writeTarOctal(header: Uint8Array, offset: number, length: number, value: number) {
	writeTarString(header, offset, length, `${value.toString(8).padStart(length - 2, '0')}\0 `);
}

function tarEntry(path: string, contents: Uint8Array, type = '0') {
	const header = new Uint8Array(512);
	writeTarString(header, 0, 100, path);
	writeTarOctal(header, 100, 8, 0o644);
	writeTarOctal(header, 108, 8, 0);
	writeTarOctal(header, 116, 8, 0);
	writeTarOctal(header, 124, 12, contents.byteLength);
	writeTarOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	writeTarString(header, 156, 1, type);
	writeTarString(header, 257, 6, 'ustar ');
	writeTarString(header, 263, 2, '00');
	const checksum = header.reduce((sum, value) => sum + value, 0);
	writeTarOctal(header, 148, 8, checksum);
	const paddedLength = Math.ceil(contents.byteLength / 512) * 512;
	const entry = new Uint8Array(512 + paddedLength);
	entry.set(header);
	entry.set(contents, 512);
	return entry;
}

function makeTar(entries: Array<{ path: string; contents?: Uint8Array; type?: string }>) {
	const encoded = entries.map((entry) =>
		tarEntry(entry.path, entry.contents ?? new Uint8Array(), entry.type ?? '0')
	);
	const size = encoded.reduce((sum, entry) => sum + entry.byteLength, 1024);
	const tar = new Uint8Array(size);
	let offset = 0;
	for (const entry of encoded) {
		tar.set(entry, offset);
		offset += entry.byteLength;
	}
	return tar;
}

const sha = '0'.repeat(64);
const llvmValidation = {
	toolchain: 'llvm-20.1.1' as const,
	moduleVerified: true as const,
	targetTriple: 'wasm32-unknown-wasi' as const,
	dataLayout: 'e-m:e-p:32:32-p10:8:8-p20:8:8-i64:64-i128:128-n32:64-S128-ni:1:10:20' as const,
	threadLocalGlobals: 0 as const,
	globalConstructors: 0 as const,
	globalDestructors: 0 as const,
	forbiddenAbiSymbols: [] as []
};
const wasmValidation = {
	profile: 'wasm-relocatable-object-v1' as const,
	linkingVersion: 2 as const,
	symbolTable: true as const
};

function wasmU32(value: number) {
	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (value !== 0);
	return bytes;
}

function wasmName(value: string) {
	const encoded = [...new TextEncoder().encode(value)];
	return [...wasmU32(encoded.length), ...encoded];
}

function wasmCustomSection(name: string, payload: readonly number[]) {
	const contents = [...wasmName(name), ...payload];
	return [0, ...wasmU32(contents.length), ...contents];
}

function wasmModule(...sections: readonly number[][]) {
	return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);
}

function relocatableWasmObject(
	options: {
		linkingVersion?: number;
		symbolFlags?: number;
		symbolName?: string;
		segmentName?: string;
		comdatKind?: number;
		initFunction?: boolean;
		programExports?: readonly string[];
	} = {}
) {
	const symbolFlags = options.symbolFlags ?? (options.symbolName === undefined ? undefined : 0);
	const symbolTable =
		symbolFlags === undefined
			? [0]
			: [1, 0, ...wasmU32(symbolFlags), 0, ...wasmName(options.symbolName ?? '__cxa_throw')];
	const segmentInfo = options.segmentName
		? [1, ...wasmName(options.segmentName), 0, 0]
		: undefined;
	const comdatInfo =
		options.comdatKind === undefined
			? undefined
			: [1, ...wasmName('group'), 0, 1, options.comdatKind, 0];
	const linkingPayload = [
		...wasmU32(options.linkingVersion ?? 2),
		...(segmentInfo ? [5, ...wasmU32(segmentInfo.length), ...segmentInfo] : []),
		...(comdatInfo ? [7, ...wasmU32(comdatInfo.length), ...comdatInfo] : []),
		8,
		...wasmU32(symbolTable.length),
		...symbolTable,
		...(options.initFunction ? [6, 3, 1, 0, 0] : [])
	];
	const programExports = options.programExports;
	if (!programExports) return wasmModule(wasmCustomSection('linking', linkingPayload));
	const typePayload = [1, 0x60, 0, 0];
	const functionPayload = [...wasmU32(programExports.length), ...programExports.map(() => 0)];
	const exportPayload = [
		...wasmU32(programExports.length),
		...programExports.flatMap((name, index) => [...wasmName(name), 0, ...wasmU32(index)])
	];
	const codePayload = [
		...wasmU32(programExports.length),
		...programExports.flatMap(() => [2, 0, 0x0b])
	];
	return wasmModule(
		[1, ...wasmU32(typePayload.length), ...typePayload],
		[3, ...wasmU32(functionPayload.length), ...functionPayload],
		[7, ...wasmU32(exportPayload.length), ...exportPayload],
		[10, ...wasmU32(codePayload.length), ...codePayload],
		wasmCustomSection('linking', linkingPayload)
	);
}

function relocatableWasmObjectWithRelocation(type: number, referencedIndex = 0) {
	const target = wasmCustomSection(
		'payload',
		Array.from({ length: 16 }, () => 0)
	);
	const symbolTable = [1, 0, 0, 0, ...wasmName('ok')];
	const linking = wasmCustomSection('linking', [
		2,
		8,
		...wasmU32(symbolTable.length),
		...symbolTable
	]);
	const relocation = wasmCustomSection('reloc.payload', [
		0,
		1,
		type,
		0,
		...wasmU32(referencedIndex),
		...([3, 4, 5, 8, 9, 11, 14, 15, 16, 17, 21, 22, 23, 25].includes(type) ? [0] : [])
	]);
	return wasmModule(target, linking, relocation);
}

function executableWasmModule(
	options: {
		importModule?: string;
		targetFeature?: string;
		targetFeatures?: readonly string[];
		imports?: ReadonlyArray<{ module: string; name: string }>;
		omitTargetFeatures?: boolean;
		startSection?: boolean;
		startParameters?: number;
		startResults?: number;
		extraV128Function?: boolean;
	} = {}
) {
	const startParameters = options.startParameters ?? 0;
	const startResults = options.startResults ?? 0;
	const type = [
		options.extraV128Function ? 2 : 1,
		0x60,
		startParameters,
		...Array.from({ length: startParameters }, () => 0x7f),
		startResults,
		...Array.from({ length: startResults }, () => 0x7f),
		...(options.extraV128Function ? [0x60, 1, 0x7b, 0] : [])
	];
	const imports =
		options.imports ??
		(options.importModule === undefined
			? []
			: [{ module: options.importModule, name: 'entry' }]);
	const importSection =
		imports.length > 0
			? [
					...wasmU32(imports.length),
					...imports.flatMap((entry) => [
						...wasmName(entry.module),
						...wasmName(entry.name),
						0,
						0
					])
				]
			: undefined;
	const functionCount = options.extraV128Function ? 2 : 1;
	const functions = [functionCount, 0, ...(options.extraV128Function ? [1] : [])];
	const memory = [1, 0, 1];
	const exports = [
		...wasmU32(2),
		...wasmName('_start'),
		0,
		imports.length,
		...wasmName('memory'),
		2,
		0
	];
	const startBody = [0, ...Array.from({ length: startResults }, () => [0x41, 0]).flat(), 0x0b];
	const code = [
		functionCount,
		...wasmU32(startBody.length),
		...startBody,
		...(options.extraV128Function ? [2, 0, 0x0b] : [])
	];
	const targetFeatures =
		options.targetFeatures ?? (options.targetFeature ? [options.targetFeature] : []);
	const featureSection = options.omitTargetFeatures
		? undefined
		: wasmCustomSection('target_features', [
				...wasmU32(targetFeatures.length),
				...targetFeatures.flatMap((feature) => [0x2b, ...wasmName(feature)])
			]);
	return wasmModule(
		[1, ...wasmU32(type.length), ...type],
		...(importSection ? [[2, ...wasmU32(importSection.length), ...importSection]] : []),
		[3, ...wasmU32(functions.length), ...functions],
		[5, ...wasmU32(memory.length), ...memory],
		[7, ...wasmU32(exports.length), ...exports],
		...(options.startSection ? [[8, 1, imports.length]] : []),
		[10, ...wasmU32(code.length), ...code],
		...(featureSection ? [featureSection] : [])
	);
}

function executableWasmWithBody(
	instructions: readonly number[],
	options: {
		tableCount?: number;
		memoryCount?: number;
		memoryFlags?: number;
		importedTable?: boolean;
		importedMemory?: boolean;
	} = {}
) {
	const type = [1, 0x60, 0, 0];
	const importCount =
		Number(options.importedTable ?? false) + Number(options.importedMemory ?? false);
	const imports = [
		...wasmU32(importCount),
		...(options.importedTable
			? [...wasmName('wasi_snapshot_preview1'), ...wasmName('table'), 1, 0x70, 0, 1]
			: []),
		...(options.importedMemory
			? [...wasmName('wasi_snapshot_preview1'), ...wasmName('memory'), 2, 0, 1]
			: [])
	];
	const functions = [1, 0];
	const tableCount = options.tableCount ?? 0;
	const tables = [
		...wasmU32(tableCount),
		...Array.from({ length: tableCount }, () => [0x70, 0, 1]).flat()
	];
	const memoryCount = options.memoryCount ?? 1;
	const memoryFlags = options.memoryFlags ?? 0;
	const memoryType = [
		...wasmU32(memoryFlags),
		1,
		...(memoryFlags & 1 ? [1] : []),
		...(memoryFlags & 8 ? [0] : [])
	];
	const memory = [
		...wasmU32(memoryCount),
		...Array.from({ length: memoryCount }, () => memoryType).flat()
	];
	const exports = [...wasmU32(2), ...wasmName('_start'), 0, 0, ...wasmName('memory'), 2, 0];
	const body = [0, ...instructions, 0x0b];
	const code = [1, ...wasmU32(body.length), ...body];
	return wasmModule(
		[1, ...wasmU32(type.length), ...type],
		...(importCount > 0 ? [[2, ...wasmU32(imports.length), ...imports]] : []),
		[3, ...wasmU32(functions.length), ...functions],
		...(tableCount > 0 ? [[4, ...wasmU32(tables.length), ...tables]] : []),
		[5, ...wasmU32(memory.length), ...memory],
		[7, ...wasmU32(exports.length), ...exports],
		[10, ...wasmU32(code.length), ...code],
		wasmCustomSection('target_features', [0])
	);
}

function llvmBitcodeEnvelope(blockId = 8) {
	const bits: number[] = [];
	const writeBits = (value: number, width: number) => {
		for (let index = 0; index < width; index += 1) bits.push((value >>> index) & 1);
	};
	const writeVbr = (value: number, width: number) => {
		const payloadBits = width - 1;
		do {
			let chunk = value & (2 ** payloadBits - 1);
			value >>>= payloadBits;
			if (value !== 0) chunk |= 2 ** payloadBits;
			writeBits(chunk, width);
		} while (value !== 0);
	};
	writeBits(1, 2);
	writeVbr(blockId, 8);
	writeVbr(2, 4);
	while (bits.length % 32 !== 0) bits.push(0);
	writeBits(1, 32);
	writeBits(0, 32);
	const body = new Uint8Array(bits.length / 8);
	for (const [index, bit] of bits.entries()) body[index >>> 3]! |= bit << (index & 7);
	return new Uint8Array([0x42, 0x43, 0xc0, 0xde, ...body]);
}

function runtimeClosure(): TinyGoRuntimeClosure {
	const asset = (id: string, path: string, format: string, source?: string) => ({
		id,
		path,
		format,
		bytes: 1,
		sha256: sha,
		...(source ? { source } : {})
	});
	return {
		schemaVersion: 1,
		format: TINYGO_RUNTIME_CLOSURE_FORMAT,
		compilerSha256: sha,
		profile: {
			id: TINYGO_RUNTIME_PROFILE_ID,
			target: 'wasip1',
			opt: '1',
			gc: 'precise',
			panicStrategy: 'print',
			scheduler: 'asyncify',
			debug: false,
			parallelism: 1
		},
		compilerRT: asset(
			'compiler-rt',
			`runtime/${TINYGO_RUNTIME_PROFILE_ID}/compiler-rt.a`,
			'static-archive'
		),
		wasiLibc: asset(
			'wasi-libc',
			`runtime/${TINYGO_RUNTIME_PROFILE_ID}/wasi-libc.a`,
			'static-archive'
		),
		libCxx: asset('libcxx', `runtime/${TINYGO_RUNTIME_PROFILE_ID}/libcxx.a`, 'static-archive'),
		libCxxAbi: asset(
			'libcxxabi',
			`runtime/${TINYGO_RUNTIME_PROFILE_ID}/libcxxabi.a`,
			'static-archive'
		),
		extraFiles: Object.fromEntries(
			[
				['src/runtime/asm_tinygowasm.S', 'extra-0.o', 'wasm-object'],
				['src/runtime/gc_boehm.c', 'extra-1.bc', 'llvm-bitcode'],
				['src/internal/task/task_asyncify_wasm.S', 'extra-2.o', 'wasm-object']
			].map(([source, filename, format], index) => [
				source,
				asset(
					`extra-${index}`,
					`runtime/${TINYGO_RUNTIME_PROFILE_ID}/${filename}`,
					format,
					source
				)
			])
		)
	};
}

function validLinkPlan(runtime: TinyGoRuntimeClosure) {
	const runtimeInputs = [
		{ kind: 'compiler-rt', path: `${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}` },
		...Object.entries(runtime.extraFiles).map(([source, asset]) => ({
			kind: 'extra-file',
			source,
			path: `${TINYGO_ROOT_PATH}/${asset.path}`
		})),
		{ kind: 'wasi-libc', path: `${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}` }
	];
	return {
		schemaVersion: 1,
		compilerPackages: [...TINYGO_UPSTREAM_COMPILER_PACKAGES],
		linker: 'wasm-ld',
		object: 'program.o',
		output: 'program.unoptimized.wasm',
		arguments: [
			'--stack-first',
			'--no-demangle',
			'-L',
			TINYGO_ROOT_PATH,
			'-o',
			'program.unoptimized.wasm',
			'--strip-debug',
			'--compress-relocations',
			'program.o',
			...runtimeInputs.map((input) => input.path),
			'-mllvm',
			'-mcpu=generic',
			'-mllvm',
			'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
			'--lto-O1'
		],
		runtimeInputs,
		optimizer: {
			tool: 'wasm-opt',
			input: 'program.unoptimized.wasm',
			output: 'program.wasm',
			arguments: [
				'--asyncify',
				'-O1',
				'-g',
				'program.unoptimized.wasm',
				'--output',
				'program.wasm'
			]
		}
	};
}

function validLinkPlanV2(runtime: TinyGoRuntimeClosure) {
	const v1 = validLinkPlan(runtime);
	const sourceSha256 = '2'.repeat(64);
	const objects = [
		{
			kind: 'program' as const,
			path: 'objects/0000-program.o',
			format: 'wasm-object' as const,
			bytes: 1024,
			sha256: '1'.repeat(64)
		},
		{
			kind: 'embed' as const,
			path: 'objects/0001-embed.o',
			format: 'wasm-object' as const,
			bytes: 128,
			sha256: '3'.repeat(64),
			importPath: 'example.com/app',
			sourcePath: 'greeting.txt',
			sourceSha256,
			embeddedFileHash: sourceSha256.slice(0, 32)
		}
	];
	return {
		schemaVersion: 2 as const,
		format: 'wasm-llvm-tinygo-link-plan-v2' as const,
		compilerSha256: sha,
		capabilities: ['go-embed-objects'] as ['go-embed-objects'],
		compilerPackages: v1.compilerPackages,
		linker: v1.linker,
		objects,
		output: v1.output,
		arguments: v1.arguments.flatMap((argument) =>
			argument === v1.object ? objects.map((object) => object.path) : [argument]
		),
		runtimeInputs: v1.runtimeInputs,
		optimizer: v1.optimizer
	};
}

function validLinkPlanV3(
	runtime: TinyGoRuntimeClosure,
	options: { cgoSha256: string; cSha256: string; dependencySha256: string }
) {
	const v2 = validLinkPlanV2(runtime);
	const targetC = {
		kind: 'target-c' as const,
		path: 'objects/0001-target-c.bc',
		format: 'llvm-bitcode' as const,
		bytes: 64,
		sha256: '4'.repeat(64),
		importPath: 'example.com/app',
		sourceField: 'CFiles' as const,
		sourcePath: 'helper.c',
		sourceSha256: options.cSha256,
		dependencies: [
			{
				scope: 'workspace' as const,
				path: 'native.h',
				bytes: 1,
				sha256: options.dependencySha256
			}
		]
	};
	const embed = { ...v2.objects[1], path: 'objects/0002-embed.o' };
	const objects = [v2.objects[0], targetC, embed];
	const compilerRT = v2.runtimeInputs[0];
	const wasiLibc = v2.runtimeInputs.at(-1)!;
	const extras = v2.runtimeInputs.slice(1, -1);
	return {
		schemaVersion: 3 as const,
		format: 'wasm-llvm-tinygo-link-plan-v3' as const,
		compilerSha256: sha,
		capabilities: ['go-embed-objects', 'target-cgo-c'] as ['go-embed-objects', 'target-cgo-c'],
		compilerPackages: v2.compilerPackages,
		linker: v2.linker,
		objects,
		output: v2.output,
		arguments: [
			'--stack-first',
			'--no-demangle',
			'-L',
			TINYGO_ROOT_PATH,
			'-o',
			'program.unoptimized.wasm',
			'--strip-debug',
			'--compress-relocations',
			objects[0].path,
			compilerRT.path,
			...extras.map((input) => input.path),
			targetC.path,
			wasiLibc.path,
			embed.path,
			'-mllvm',
			'-mcpu=generic',
			'-mllvm',
			'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
			'--lto-O1'
		],
		runtimeInputs: v2.runtimeInputs,
		cgoInputs: [
			{
				importPath: 'example.com/app',
				sourcePath: 'native.go',
				bytes: 1,
				sha256: options.cgoSha256,
				dependencies: [
					{
						scope: 'workspace' as const,
						path: 'native.h',
						bytes: 1,
						sha256: options.dependencySha256
					}
				]
			}
		],
		optimizer: v2.optimizer
	};
}

function validLinkPlanV4(
	runtime: TinyGoRuntimeClosure,
	options: {
		cgoSha256: string;
		cSha256: string;
		cxxSha256: string;
		assemblySha256: string;
		dependencySha256: string;
	}
) {
	const v3 = validLinkPlanV3(runtime, options);
	const targetC = {
		...v3.objects[1],
		llvmValidation: structuredClone(llvmValidation)
	};
	const targetCXX = {
		kind: 'target-cxx' as const,
		path: 'objects/0002-target-cxx.bc',
		format: 'llvm-bitcode' as const,
		bytes: 72,
		sha256: '5'.repeat(64),
		importPath: 'example.com/app',
		sourceField: 'CXXFiles' as const,
		sourcePath: 'helper.cc',
		sourceSha256: options.cxxSha256,
		dependencies: [
			{
				scope: 'workspace' as const,
				path: 'native.h',
				bytes: 1,
				sha256: options.dependencySha256
			}
		],
		llvmValidation: structuredClone(llvmValidation)
	};
	const targetAssembly = {
		kind: 'target-assembly' as const,
		path: 'objects/0003-target-assembly.o',
		format: 'wasm-object' as const,
		bytes: 80,
		sha256: '6'.repeat(64),
		importPath: 'example.com/app',
		sourceField: 'SFiles' as const,
		sourcePath: 'add.S',
		sourceSha256: options.assemblySha256,
		dependencies: [
			{
				scope: 'workspace' as const,
				path: 'native.h',
				bytes: 1,
				sha256: options.dependencySha256
			}
		],
		wasmValidation: structuredClone(wasmValidation)
	};
	const embed = { ...v3.objects[2], path: 'objects/0004-embed.o' };
	const objects = [v3.objects[0], targetC, targetCXX, targetAssembly, embed];
	const compilerRT = v3.runtimeInputs[0];
	const wasiLibc = v3.runtimeInputs.at(-1)!;
	const extras = v3.runtimeInputs.slice(1, -1);
	return {
		...v3,
		schemaVersion: 4 as const,
		format: 'wasm-llvm-tinygo-link-plan-v4' as const,
		capabilities: [
			'go-embed-objects',
			'target-cgo-c',
			'target-cxx-freestanding',
			'target-clang-assembly'
		] as [
			'go-embed-objects',
			'target-cgo-c',
			'target-cxx-freestanding',
			'target-clang-assembly'
		],
		objects,
		arguments: [
			'--stack-first',
			'--no-demangle',
			'-L',
			TINYGO_ROOT_PATH,
			'-o',
			'program.unoptimized.wasm',
			'--strip-debug',
			'--compress-relocations',
			objects[0].path,
			compilerRT.path,
			...extras.map((input) => input.path),
			targetC.path,
			targetCXX.path,
			targetAssembly.path,
			wasiLibc.path,
			embed.path,
			'-mllvm',
			'-mcpu=generic',
			'-mllvm',
			'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
			'--lto-O1'
		]
	};
}

function validLinkPlanV5(
	runtime: TinyGoRuntimeClosure,
	options: Parameters<typeof validLinkPlanV4>[1]
) {
	const v4 = validLinkPlanV4(runtime, options);
	const libcxx = {
		kind: 'libcxx',
		path: `${TINYGO_ROOT_PATH}/${runtime.libCxx!.path}`
	};
	const libcxxabi = {
		kind: 'libcxxabi',
		path: `${TINYGO_ROOT_PATH}/${runtime.libCxxAbi!.path}`
	};
	const wasiIndex = v4.arguments.indexOf(`${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`);
	const linkArguments = [...v4.arguments];
	linkArguments.splice(wasiIndex, 0, libcxx.path, libcxxabi.path);
	return {
		...v4,
		schemaVersion: 5 as const,
		format: 'wasm-llvm-tinygo-link-plan-v5' as const,
		capabilities: [
			'go-embed-objects',
			'target-cgo-c',
			'target-cxx-hosted-noeh',
			'target-clang-assembly'
		] as const,
		arguments: linkArguments,
		runtimeInputs: [
			...v4.runtimeInputs.slice(0, -1),
			libcxx,
			libcxxabi,
			v4.runtimeInputs.at(-1)!
		]
	};
}

function validLinkPlanV6(
	runtime: TinyGoRuntimeClosure,
	options: Parameters<typeof validLinkPlanV4>[1]
) {
	const v5 = validLinkPlanV5(runtime, options);
	const objects = structuredClone(v5.objects);
	objects[2]!.compilerFlags = ['-DCPP_VALUE=7'];
	const linkArguments = [...v5.arguments];
	linkArguments.splice(linkArguments.indexOf('-o'), 0, '-lexample');
	return {
		...v5,
		schemaVersion: 6 as const,
		format: 'wasm-llvm-tinygo-link-plan-v6' as const,
		capabilities: [
			'go-embed-objects',
			'target-cgo-c',
			'target-cxx-hosted-noeh',
			'target-clang-assembly',
			'target-cgo-cxxflags',
			'target-cgo-linker-flags'
		] as const,
		objects,
		arguments: linkArguments,
		cgoLinkerFlags: ['-lexample']
	};
}

test('reports memory-file descriptor rights required by wasi-libc and Clang', () => {
	const readonly = new OpenFile(new File([], { readonly: true })).fd_fdstat_get().fdstat;
	const writable = new OpenFile(new File([])).fd_fdstat_get().fdstat;
	const directory = new OpenDirectory(new Directory(new Map())).fd_fdstat_get().fdstat;
	assert.ok(readonly);
	assert.ok(writable);
	assert.ok(directory);
	assert.notEqual(readonly.fs_rights_base & BigInt(wasi.RIGHTS_FD_READ), 0n);
	assert.equal(readonly.fs_rights_base & BigInt(wasi.RIGHTS_FD_WRITE), 0n);
	assert.notEqual(writable.fs_rights_base & BigInt(wasi.RIGHTS_FD_WRITE), 0n);
	assert.notEqual(directory.fs_rights_base & BigInt(wasi.RIGHTS_PATH_OPEN), 0n);
	assert.notEqual(directory.fs_rights_inherited & BigInt(wasi.RIGHTS_FD_WRITE), 0n);
});

test('validates LLVM envelopes, relocatable Wasm metadata, and final WASI modules', async () => {
	assert.doesNotThrow(() => assertTinyGoLLVMBitcodeEnvelope(llvmBitcodeEnvelope(), 'bitcode'));
	assert.throws(
		() => assertTinyGoLLVMBitcodeEnvelope(new Uint8Array([0x42, 0x43, 0xc0, 0xde]), 'bitcode'),
		/not an aligned LLVM bitstream/u
	);
	assert.throws(
		() => assertTinyGoLLVMBitcodeEnvelope(llvmBitcodeEnvelope(7), 'bitcode'),
		/unsupported top-level LLVM block/u
	);

	assert.deepEqual(assertTinyGoRelocatableWasmObject(relocatableWasmObject(), 'object'), {
		linkingVersion: 2,
		symbolCount: 0,
		symbolTable: true
	});
	const upstreamProgramExports = [
		'malloc',
		'__libc_malloc',
		'aligned_alloc',
		'free',
		'__libc_free',
		'calloc',
		'__libc_calloc',
		'realloc',
		'__libc_realloc',
		'_start'
	];
	const upstreamProgramObject = relocatableWasmObject({
		programExports: upstreamProgramExports,
		symbolName: '__wasm_call_ctors',
		symbolFlags: 0x50
	});
	assert.doesNotThrow(() =>
		assertTinyGoRelocatableWasmObject(upstreamProgramObject, 'program object', {
			profile: 'upstream-program'
		})
	);
	assert.throws(
		() => assertTinyGoRelocatableWasmObject(upstreamProgramObject, 'auxiliary object'),
		/executable-only export or start behavior/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				relocatableWasmObject({
					programExports: upstreamProgramExports,
					symbolName: '__wasm_call_ctors',
					symbolFlags: 0
				}),
				'program object',
				{ profile: 'upstream-program' }
			),
		/forbidden native ABI symbol __wasm_call_ctors/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				relocatableWasmObject({
					programExports: [...upstreamProgramExports, 'unexpected']
				}),
				'program object',
				{ profile: 'upstream-program' }
			),
		/unexpected program export/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				relocatableWasmObject({ linkingVersion: 1 }),
				'object'
			),
		/unsupported WebAssembly linking version/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				relocatableWasmObject({ symbolFlags: 0x100 }),
				'object'
			),
		/forbidden thread-local storage metadata/u
	);
	assert.throws(
		() => assertTinyGoRelocatableWasmObject(relocatableWasmObjectWithRelocation(14), 'object'),
		/forbidden memory64 or table64 relocation/u
	);
	assert.throws(
		() => assertTinyGoRelocatableWasmObject(relocatableWasmObjectWithRelocation(10), 'object'),
		/forbidden exception event relocation/u
	);
	assert.doesNotThrow(() =>
		assertTinyGoRelocatableWasmObject(relocatableWasmObjectWithRelocation(6, 99), 'object')
	);
	assert.doesNotThrow(() =>
		assertTinyGoRelocatableWasmObject(relocatableWasmObjectWithRelocation(26, 99), 'object')
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(relocatableWasmObject({ symbolFlags: 0 }), 'object'),
		/forbidden native ABI symbol __cxa_throw/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				relocatableWasmObject({ initFunction: true }),
				'object'
			),
		/forbidden native initialization functions/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				wasmModule(wasmCustomSection('linking', [])),
				'object'
			),
		/truncated WebAssembly u32/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				wasmModule(
					wasmCustomSection('linking', [2, 8, 1, 0]),
					wasmCustomSection('dylink', [])
				),
				'object'
			),
		/dynamic-linking metadata/u
	);
	for (const symbol of [
		'__wasm_call_ctors',
		'__wasm_apply_data_relocs',
		'__dso_handle',
		'__cxx_global_var_init',
		'_GLOBAL__I_runtime_init',
		'_ZZ3foovE5value',
		'_ZTV4Type',
		'_ZNSt6vectorIiE3endEv',
		'_ZNKSt6vectorIiE4sizeEv',
		'_ZSt4moveIiEOT_RNSt16remove_referenceIS1_E4typeE'
	]) {
		assert.throws(
			() =>
				assertTinyGoRelocatableWasmObject(
					relocatableWasmObject({ symbolName: symbol }),
					'object'
				),
			/forbidden native ABI symbol/u
		);
	}
	for (const segmentName of [
		'.preinit_array',
		'.init_array.100',
		'.fini_array',
		'.ctors',
		'.dtors.200'
	]) {
		assert.throws(
			() =>
				assertTinyGoRelocatableWasmObject(relocatableWasmObject({ segmentName }), 'object'),
			/forbidden native lifetime segment/u
		);
	}
	assert.doesNotThrow(() =>
		assertTinyGoRelocatableWasmObject(relocatableWasmObject({ comdatKind: 4 }), 'object')
	);
	assert.throws(
		() => assertTinyGoRelocatableWasmObject(relocatableWasmObject({ comdatKind: 3 }), 'object'),
		/COMDAT .* invalid symbol kind/u
	);
	assert.throws(
		() =>
			assertTinyGoRelocatableWasmObject(
				wasmModule(...Array.from({ length: 4097 }, () => wasmCustomSection('x', []))),
				'object'
			),
		/section-count limit/u
	);

	await assert.doesNotReject(assertTinyGoFinalWasmModule(executableWasmModule(), 'final'));
	const preAsyncifyModule = executableWasmModule({
		targetFeatures: ['multivalue', 'reference-types'],
		imports: [
			{ module: 'asyncify', name: 'stop_rewind' },
			{ module: 'asyncify', name: 'start_unwind' },
			{ module: 'asyncify', name: 'stop_unwind' },
			{ module: 'asyncify', name: 'start_rewind' }
		]
	});
	await assert.doesNotReject(
		assertTinyGoFinalWasmModule(preAsyncifyModule, 'raw linked module', {
			phase: 'pre-asyncify'
		})
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(preAsyncifyModule, 'final'),
		/imports outside the WASI function boundary/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(
			executableWasmModule({
				targetFeatures: ['multivalue', 'reference-types'],
				imports: [{ module: 'asyncify', name: 'start_unwind' }]
			}),
			'raw linked module',
			{ phase: 'pre-asyncify' }
		),
		/missing required asyncify import/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ importModule: 'env' }), 'final'),
		/imports outside the WASI function boundary/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ targetFeature: 'simd128' }), 'final'),
		/forbidden target feature simd128/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ omitTargetFeatures: true }), 'final'),
		/no target_features metadata/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ startSection: true }), 'final'),
		/forbidden core start section/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ startParameters: 1 }), 'final'),
		/_start must be a defined \(\) -> \(\) function/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(executableWasmModule({ extraV128Function: true }), 'final'),
		/forbidden v128 value types/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(
			executableWasmModule({ targetFeature: 'multivalue', startResults: 2 }),
			'final'
		),
		/multivalue function types/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(
			executableWasmWithBody([0x41, 0, 0x41, 0, 0x41, 0, 0xfc, 14, 0, 0], { tableCount: 1 }),
			'final'
		),
		/forbidden reference-type prefixed instructions/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(
			executableWasmWithBody([], { tableCount: 1, importedTable: true }),
			'final'
		),
		/more than one table/u
	);
	await assert.rejects(
		assertTinyGoFinalWasmModule(
			executableWasmWithBody([], { memoryCount: 1, importedMemory: true }),
			'final'
		),
		/more than one linear memory/u
	);
	const originalValidate = WebAssembly.validate;
	let nonzeroTableIndex!: Promise<void>;
	let nonzeroMemoryIndex!: Promise<void>;
	let nonzeroBulkMemoryIndex!: Promise<void>;
	let customPageSize!: Promise<void>;
	Object.defineProperty(WebAssembly, 'validate', { configurable: true, value: () => true });
	try {
		nonzeroTableIndex = assertTinyGoFinalWasmModule(
			executableWasmWithBody([0x41, 0, 0x11, 0, 1], { tableCount: 1 }),
			'final'
		);
		nonzeroMemoryIndex = assertTinyGoFinalWasmModule(
			executableWasmWithBody([0x3f, 1, 0x1a]),
			'final'
		);
		nonzeroBulkMemoryIndex = assertTinyGoFinalWasmModule(
			executableWasmWithBody([0x41, 0, 0x41, 0, 0x41, 0, 0xfc, 11, 1]),
			'final'
		);
		customPageSize = assertTinyGoFinalWasmModule(
			executableWasmWithBody([], { memoryFlags: 8 }),
			'final'
		);
	} finally {
		Object.defineProperty(WebAssembly, 'validate', {
			configurable: true,
			value: originalValidate
		});
	}
	await Promise.all([
		assert.rejects(nonzeroTableIndex, /nonzero call_indirect table index/u),
		assert.rejects(nonzeroMemoryIndex, /nonzero memory instruction index/u),
		assert.rejects(nonzeroBulkMemoryIndex, /nonzero bulk-memory instruction index/u),
		assert.rejects(customPageSize, /unsupported WebAssembly limits flags/u)
	]);
});

test('extracts binary ustar files and rejects traversal entries', () => {
	const source = new TextEncoder().encode('package main\n');
	const root = extractTinyGoRootTar(
		makeTar([
			{ path: 'src/', type: '5' },
			{ path: 'src/main.go', contents: source }
		])
	);
	assert.equal(hasTinyGoVfsPath(root, 'src', 'directory'), true);
	assert.deepEqual(readTinyGoVfsFile(root, 'src/main.go'), source);
	assert.throws(
		() => extractTinyGoRootTar(makeTar([{ path: '../escape', contents: source }])),
		/unsafe TinyGo VFS path/
	);
	assert.throws(
		() => extractTinyGoRootTar(makeTar([{ path: 'src/link', type: '2' }])),
		/unsupported TinyGo root tar entry type/
	);
});

test('selects a fail-closed offline module mode from the mounted workspace', () => {
	const workspace: TinyGoWasiDirectoryContents = new Map();
	addTinyGoVfsFile(workspace, 'go.mod', new TextEncoder().encode('module example.com/app\n'));
	assert.equal(selectTinyGoOfflineModuleMode(workspace), 'readonly');
	addTinyGoVfsFile(workspace, 'vendor/example.com/dep/dep.go', new Uint8Array([1]));
	assert.throws(
		() => selectTinyGoOfflineModuleMode(workspace),
		/vendor directory requires vendor\/modules\.txt/u
	);
	addTinyGoVfsFile(
		workspace,
		'vendor/modules.txt',
		new TextEncoder().encode('# example.com/dep v1.0.0\n')
	);
	assert.equal(selectTinyGoOfflineModuleMode(workspace), 'vendor');
});

test('normalizes go list JSON paths and validates the exact mounted package graph', () => {
	const hostRoot = '/producer/root';
	const hostWorkspace = '/producer/fixture';
	const raw = [
		{
			Dir: `${hostRoot}/src/fmt`,
			ImportPath: 'fmt',
			Root: hostRoot,
			Goroot: true,
			GoFiles: ['print.go']
		},
		{
			Dir: `${hostWorkspace}/helper`,
			ImportPath: 'example.com/app/helper',
			GoFiles: ['helper.go']
		},
		{
			Dir: hostWorkspace,
			ImportPath: '_/producer/fixture',
			GoFiles: ['main.go'],
			Imports: ['example.com/app/helper', 'fmt']
		}
	]
		.map((value) => JSON.stringify(value))
		.join('\n');
	const normalized = normalizeTinyGoPackageJSON(raw, [
		{ from: hostRoot, to: TINYGO_ROOT_PATH },
		{ from: hostWorkspace, to: TINYGO_WORKSPACE_PATH }
	]);
	const root: TinyGoWasiDirectoryContents = new Map();
	const workspace: TinyGoWasiDirectoryContents = new Map();
	addTinyGoVfsFile(root, 'src/fmt/print.go', new Uint8Array([1]));
	addTinyGoVfsFile(workspace, 'main.go', new Uint8Array([2]));
	addTinyGoVfsFile(workspace, 'helper/helper.go', new Uint8Array([3]));
	const packages = validateTinyGoPackageJSON({ packageJSON: normalized, root, workspace });
	assert.equal(packages.length, 3);
	assert.match(normalized, /"Dir":"\/tinygo-root\/src\/fmt"/u);
	assert.doesNotMatch(normalized, /"(?:Dir|Root)":"\/producer\//u);

	const cgo = `${normalized.trim()}\n${JSON.stringify({
		Dir: TINYGO_WORKSPACE_PATH,
		ImportPath: 'bad',
		CgoFiles: ['native.go']
	})}\n`;
	assert.throws(
		() => validateTinyGoPackageJSON({ packageJSON: cgo, root, workspace }),
		/target CGo\/C files, unsupported until compile protocol v3/
	);
	addTinyGoVfsFile(workspace, 'native.go', new Uint8Array([4]));
	addTinyGoVfsFile(workspace, 'helper.c', new Uint8Array([5]));
	addTinyGoVfsFile(workspace, 'helper.cc', new Uint8Array([6]));
	addTinyGoVfsFile(workspace, 'add.S', new Uint8Array([7]));
	addTinyGoVfsFile(workspace, 'add.s', new Uint8Array([8]));
	const native = normalized
		.replace(
			'"GoFiles":["main.go"]',
			'"GoFiles":["main.go"],"CgoFiles":["native.go"],"CFiles":["helper.c"]'
		)
		.replace(
			'"Imports":["example.com/app/helper","fmt"]',
			'"Imports":["C","example.com/app/helper","fmt"]'
		);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: native,
			root,
			workspace,
			compileProtocolVersion: 3
		})
	);
	const cxx = native.replace('"CFiles":["helper.c"]', '"CXXFiles":["helper.cc"]');
	assert.throws(
		() =>
			validateTinyGoPackageJSON({
				packageJSON: cxx,
				root,
				workspace,
				compileProtocolVersion: 3
			}),
		/C\+\+ files, unsupported until compile protocol v4/u
	);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: cxx,
			root,
			workspace,
			compileProtocolVersion: 4
		})
	);
	const cxxFlags = cxx.replace(
		'"CXXFiles":["helper.cc"]',
		'"CXXFiles":["helper.cc"],"CgoCXXFLAGS":["-DCPP_VALUE=7"],"CgoLDFLAGS":["-lexample"]'
	);
	assert.throws(
		() =>
			validateTinyGoPackageJSON({
				packageJSON: cxxFlags,
				root,
				workspace,
				compileProtocolVersion: 5
			}),
		/CXXFLAGS.*compile protocol v6/u
	);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: cxxFlags,
			root,
			workspace,
			compileProtocolVersion: 6
		})
	);
	const embedded = normalized.replace(
		'"GoFiles":["main.go"]',
		'"GoFiles":["main.go"],"EmbedFiles":["main.go"]'
	);
	assert.throws(
		() => validateTinyGoPackageJSON({ packageJSON: embedded, root, workspace }),
		/go:embed files, unsupported until compile protocol v2/u
	);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: embedded,
			root,
			workspace,
			compileProtocolVersion: 2
		})
	);
	const rootAssembly = normalized.replace(
		'"GoFiles":["print.go"]',
		'"GoFiles":["print.go"],"SFiles":["print.go"]'
	);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: rootAssembly,
			root,
			workspace,
			compileProtocolVersion: 2
		})
	);
	const assembly = normalized.replace(
		'"GoFiles":["main.go"]',
		'"GoFiles":["main.go"],"SFiles":["add.S"]'
	);
	assert.throws(
		() =>
			validateTinyGoPackageJSON({
				packageJSON: assembly,
				root,
				workspace,
				compileProtocolVersion: 2
			}),
		/workspace assembly files, unsupported until compile protocol v4/u
	);
	assert.throws(
		() =>
			validateTinyGoPackageJSON({
				packageJSON: assembly,
				root,
				workspace,
				compileProtocolVersion: 4
			}),
		/workspace assembly outside a CGo package/u
	);
	const clangAssembly = native.replace(
		'"CFiles":["helper.c"]',
		'"CFiles":["helper.c"],"SFiles":["add.S"]'
	);
	assert.doesNotThrow(() =>
		validateTinyGoPackageJSON({
			packageJSON: clangAssembly,
			root,
			workspace,
			compileProtocolVersion: 4
		})
	);
	const lowercaseAssembly = clangAssembly.replace('"SFiles":["add.S"]', '"SFiles":["add.s"]');
	assert.throws(
		() =>
			validateTinyGoPackageJSON({
				packageJSON: lowercaseAssembly,
				root,
				workspace,
				compileProtocolVersion: 4
			}),
		/requires uppercase \.S files/u
	);
	const packageError = normalized.replace(
		'"GoFiles":["main.go"]',
		'"GoFiles":["main.go"],"Error":{"Err":"cannot find package missing"}'
	);
	assert.throws(
		() => validateTinyGoPackageJSON({ packageJSON: packageError, root, workspace }),
		/TinyGo package discovery failed.*cannot find package missing/u
	);
	const incomplete = normalized.replace(
		'"Imports":["example.com/app/helper","fmt"]',
		'"Imports":["missing"]'
	);
	assert.throws(
		() => validateTinyGoPackageJSON({ packageJSON: incomplete, root, workspace }),
		/references missing dependency missing/
	);
	const spuriousC = normalized.replace(
		'"Imports":["example.com/app/helper","fmt"]',
		'"Imports":["C","example.com/app/helper","fmt"]'
	);
	assert.throws(
		() => validateTinyGoPackageJSON({ packageJSON: spuriousC, root, workspace }),
		/references missing dependency C/
	);
});

test('loads only manifest-declared upstream assets through the existing browser asset loader', async () => {
	const values = {
		'producer-receipt.json': new Uint8Array([1]),
		'package-graph-provider-receipt.json': new Uint8Array([5]),
		'tinygo-compiler.wasm': new Uint8Array([2]),
		'tinygo-package-graph.wasm': new Uint8Array([6]),
		'tinygoroot.tar.gz': new Uint8Array([3]),
		'lld.wasm': new Uint8Array([4])
	};
	const evidence = async (path: keyof typeof values) => ({
		path,
		bytes: values[path].byteLength,
		sha256: await sha256TinyGoBytes(values[path])
	});
	const manifest = new TextEncoder().encode(
		JSON.stringify({
			schemaVersion: 2,
			format: TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT,
			producerReceipt: await evidence('producer-receipt.json'),
			packageGraphReceipt: await evidence('package-graph-provider-receipt.json'),
			assets: {
				compiler: await evidence('tinygo-compiler.wasm'),
				packageGraph: await evidence('tinygo-package-graph.wasm'),
				rootArchive: await evidence('tinygoroot.tar.gz'),
				lld: await evidence('lld.wasm')
			}
		})
	);
	const assetReceipts = Object.fromEntries(
		await Promise.all(
			Object.entries(values).map(async ([assetPath, bytes]) => [
				`tools/upstream/${assetPath}`,
				{ bytes: bytes.byteLength, sha256: await sha256TinyGoBytes(bytes) }
			])
		)
	);
	const profileBase = {
		profileId: 'tinygo-test-wasip1-v6',
		protocolVersion: 6 as const,
		manifestPath: 'tools/upstream/upstream-toolchain.v2.json',
		manifestFingerprint: '0'.repeat(64),
		manifestReceipt: {
			bytes: manifest.byteLength,
			sha256: await sha256TinyGoBytes(manifest)
		},
		assetReceipts
	};
	const profile = {
		...profileBase,
		manifestFingerprint: await computeTinyGoRuntimeProfileFingerprint(profileBase)
	};
	const requested: string[] = [];
	const loaded = await loadTinyGoUpstreamToolchainAssets({
		assetBaseUrl: 'https://example.invalid/runtime/',
		profile,
		loader: ({ assetPath }) => {
			requested.push(assetPath);
			if (assetPath.endsWith('upstream-toolchain.v2.json')) return manifest;
			const name = assetPath.split('/').at(-1) as keyof typeof values;
			return values[name];
		}
	});
	assert.deepEqual(loaded.compiler, values['tinygo-compiler.wasm']);
	assert.deepEqual(loaded.packageGraph, values['tinygo-package-graph.wasm']);
	assert.deepEqual(requested, [
		'tools/upstream/upstream-toolchain.v2.json',
		'tools/upstream/producer-receipt.json',
		'tools/upstream/package-graph-provider-receipt.json',
		'tools/upstream/tinygo-compiler.wasm',
		'tools/upstream/tinygo-package-graph.wasm',
		'tools/upstream/tinygoroot.tar.gz',
		'tools/upstream/lld.wasm'
	]);

	const forgedManifest = Uint8Array.from(manifest);
	forgedManifest[0] ^= 1;
	const forgedRequests: string[] = [];
	await assert.rejects(
		loadTinyGoUpstreamToolchainAssets({
			assetBaseUrl: 'https://mirror.invalid/runtime/',
			profile,
			loader: ({ assetPath }) => {
				forgedRequests.push(assetPath);
				return forgedManifest;
			}
		}),
		/upstream TinyGo toolchain manifest logical SHA-256 differs from its runtime profile/u
	);
	assert.deepEqual(forgedRequests, ['tools/upstream/upstream-toolchain.v2.json']);

	await assert.rejects(
		loadTinyGoUpstreamToolchainAssets({
			assetBaseUrl: 'https://mirror.invalid/runtime/',
			profile,
			loader: ({ assetPath }) => {
				if (assetPath.endsWith('upstream-toolchain.v2.json')) return manifest;
				const name = assetPath.split('/').at(-1) as keyof typeof values;
				return name === 'tinygo-compiler.wasm' ? new Uint8Array([99]) : values[name];
			}
		}),
		/upstream TinyGo compiler logical SHA-256 differs from its runtime profile/u
	);
});

test('hashes TinyGo bytes consistently without requiring an ArrayBuffer-backed input', async () => {
	const expected = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
	assert.equal(await sha256TinyGoBytes(new Uint8Array([1, 2, 3])), expected);
	if (typeof SharedArrayBuffer === 'function') {
		const shared = new Uint8Array(new SharedArrayBuffer(3));
		shared.set([1, 2, 3]);
		assert.equal(await sha256TinyGoBytes(shared), expected);
	}
});

test('binds compiler, root, LLD, and the passed upstream producer receipt by SHA-256', async () => {
	const compiler = new Uint8Array([1, 2, 3]);
	const packageGraph = new Uint8Array([9, 10, 11]);
	const rootArchive = new Uint8Array([4, 5]);
	const lld = new Uint8Array([6, 7, 8]);
	const receiptValue = {
		schemaVersion: 1,
		format: 'wasm-llvm-tinygo-browser-compiler-v1',
		producerId: 'wasm-llvm/tinygo-browser',
		build: {
			entrypoint: {
				mode: 'upstream-compiler-adapter',
				upstreamModule: 'github.com/tinygo-org/tinygo'
			},
			hostTarget: 'wasm32-wasip1',
			cgoEnabled: true,
			llvmLinkage: 'in-process-c-api',
			hostCompileFallback: false,
			packageGraph: [...TINYGO_UPSTREAM_COMPILER_PACKAGES]
		},
		verification: {
			status: 'passed',
			identityMode: 'upstream-package-graph',
			acceptance: { status: 'passed' }
		},
		assets: [
			{
				path: 'tinygo-compiler.wasm',
				bytes: compiler.byteLength,
				sha256: await sha256TinyGoBytes(compiler)
			},
			{
				path: 'tinygoroot.tar.gz',
				bytes: rootArchive.byteLength,
				sha256: await sha256TinyGoBytes(rootArchive)
			}
		]
	};
	const producerReceipt = new TextEncoder().encode(JSON.stringify(receiptValue));
	const packageGraphReceiptValue = {
		schemaVersion: 1,
		format: 'wasm-llvm-tinygo-package-graph-provider-v2',
		producerId: 'wasm-llvm/tinygo-browser/package-graph',
		status: 'passed',
		upstream: {
			module: 'golang.org/toolchain',
			version: 'go1.24.6',
			entrypoint: 'cmd/go',
			identityPackages: [...TINYGO_UPSTREAM_PACKAGE_GRAPH_PACKAGES]
		},
		protocol: {
			command: 'list',
			arguments: [
				`-json=${TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
				'-deps',
				'-e',
				'-mod=readonly',
				`-tags=${TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
				'.'
			],
			argumentsByModuleMode: {
				readonly: [
					`-json=${TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
					'-deps',
					'-e',
					'-mod=readonly',
					`-tags=${TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
					'.'
				],
				vendor: [
					`-json=${TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
					'-deps',
					'-e',
					'-mod=vendor',
					`-tags=${TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
					'.'
				]
			},
			moduleModes: ['readonly', 'vendor'],
			environment: {
				GOOS: 'wasip1',
				GOARCH: 'wasm',
				CGO_ENABLED: '1',
				GOTOOLCHAIN: 'local',
				GOPROXY: 'off',
				GOSUMDB: 'off',
				GOVCS: 'off',
				GOENV: 'off'
			},
			maxBytes: 64 * 1024 * 1024,
			maxPackages: 16_384
		},
		acceptance: {
			status: 'passed',
			comparison: 'same-pinned-native-cmd-go-exact-json'
		},
		assets: [
			{
				path: 'tinygo-package-graph.wasm',
				bytes: packageGraph.byteLength,
				sha256: await sha256TinyGoBytes(packageGraph)
			}
		]
	};
	const packageGraphReceipt = new TextEncoder().encode(JSON.stringify(packageGraphReceiptValue));
	const evidence = async (path: string, bytes: Uint8Array) => ({
		path,
		bytes: bytes.byteLength,
		sha256: await sha256TinyGoBytes(bytes)
	});
	const manifest = {
		schemaVersion: 2,
		format: TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT,
		producerReceipt: await evidence('producer-receipt.json', producerReceipt),
		packageGraphReceipt: await evidence(
			'package-graph-provider-receipt.json',
			packageGraphReceipt
		),
		assets: {
			compiler: await evidence('tinygo-compiler.wasm', compiler),
			packageGraph: await evidence('tinygo-package-graph.wasm', packageGraph),
			rootArchive: await evidence('tinygoroot.tar.gz', rootArchive),
			lld: await evidence('lld.wasm', lld)
		}
	};
	const verified = await verifyTinyGoUpstreamAssetSet({
		manifest,
		producerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verified.compileProtocolVersion, 1);
	const v2ReceiptValue = structuredClone(receiptValue);
	v2ReceiptValue.schemaVersion = 2;
	v2ReceiptValue.format = 'wasm-llvm-tinygo-browser-compiler-v2';
	Object.assign(v2ReceiptValue.build, {
		compileProtocol: {
			version: 2,
			format: 'wasm-llvm-tinygo-link-plan-v2',
			capabilities: ['go-embed-objects']
		},
		compileOutputs: ['objects', 'link-plan.json']
	});
	const v2ProducerReceipt = new TextEncoder().encode(JSON.stringify(v2ReceiptValue));
	const v2Manifest = {
		...manifest,
		producerReceipt: await evidence('producer-receipt.json', v2ProducerReceipt)
	};
	const verifiedV2 = await verifyTinyGoUpstreamAssetSet({
		manifest: v2Manifest,
		producerReceipt: v2ProducerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verifiedV2.compileProtocolVersion, 2);
	const v3ReceiptValue = structuredClone(receiptValue);
	v3ReceiptValue.schemaVersion = 3;
	v3ReceiptValue.format = 'wasm-llvm-tinygo-browser-compiler-v3';
	Object.assign(v3ReceiptValue.build, {
		compileProtocol: {
			version: 3,
			format: 'wasm-llvm-tinygo-link-plan-v3',
			capabilities: ['go-embed-objects', 'target-cgo-c']
		},
		compileOutputs: ['objects', 'link-plan.json']
	});
	const v3ProducerReceipt = new TextEncoder().encode(JSON.stringify(v3ReceiptValue));
	const verifiedV3 = await verifyTinyGoUpstreamAssetSet({
		manifest: {
			...manifest,
			producerReceipt: await evidence('producer-receipt.json', v3ProducerReceipt)
		},
		producerReceipt: v3ProducerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verifiedV3.compileProtocolVersion, 3);
	const v4ReceiptValue = structuredClone(receiptValue);
	v4ReceiptValue.schemaVersion = 4;
	v4ReceiptValue.format = 'wasm-llvm-tinygo-browser-compiler-v4';
	Object.assign(v4ReceiptValue.build, {
		compileProtocol: {
			version: 4,
			format: 'wasm-llvm-tinygo-link-plan-v4',
			capabilities: [
				'go-embed-objects',
				'target-cgo-c',
				'target-cxx-freestanding',
				'target-clang-assembly'
			]
		},
		compileOutputs: ['objects', 'link-plan.json']
	});
	const v4ProducerReceipt = new TextEncoder().encode(JSON.stringify(v4ReceiptValue));
	const verifiedV4 = await verifyTinyGoUpstreamAssetSet({
		manifest: {
			...manifest,
			producerReceipt: await evidence('producer-receipt.json', v4ProducerReceipt)
		},
		producerReceipt: v4ProducerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verifiedV4.compileProtocolVersion, 4);
	const v5ReceiptValue = structuredClone(receiptValue);
	v5ReceiptValue.schemaVersion = 5;
	v5ReceiptValue.format = 'wasm-llvm-tinygo-browser-compiler-v5';
	Object.assign(v5ReceiptValue.build, {
		compileProtocol: {
			version: 5,
			format: 'wasm-llvm-tinygo-link-plan-v5',
			capabilities: [
				'go-embed-objects',
				'target-cgo-c',
				'target-cxx-hosted-noeh',
				'target-clang-assembly'
			]
		},
		compileOutputs: ['objects', 'link-plan.json'],
		rootArchive: { runtimeClosureFormat: TINYGO_RUNTIME_CLOSURE_FORMAT }
	});
	const v5ProducerReceipt = new TextEncoder().encode(JSON.stringify(v5ReceiptValue));
	const verifiedV5 = await verifyTinyGoUpstreamAssetSet({
		manifest: {
			...manifest,
			producerReceipt: await evidence('producer-receipt.json', v5ProducerReceipt)
		},
		producerReceipt: v5ProducerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verifiedV5.compileProtocolVersion, 5);
	const v6ReceiptValue = structuredClone(v5ReceiptValue);
	v6ReceiptValue.schemaVersion = 6;
	v6ReceiptValue.format = 'wasm-llvm-tinygo-browser-compiler-v6';
	v6ReceiptValue.build.compileProtocol = {
		version: 6,
		format: 'wasm-llvm-tinygo-link-plan-v6',
		capabilities: [
			'go-embed-objects',
			'target-cgo-c',
			'target-cxx-hosted-noeh',
			'target-clang-assembly',
			'target-cgo-cxxflags',
			'target-cgo-linker-flags'
		]
	};
	const v6ProducerReceipt = new TextEncoder().encode(JSON.stringify(v6ReceiptValue));
	const verifiedV6 = await verifyTinyGoUpstreamAssetSet({
		manifest: {
			...manifest,
			producerReceipt: await evidence('producer-receipt.json', v6ProducerReceipt)
		},
		producerReceipt: v6ProducerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	assert.equal(verifiedV6.compileProtocolVersion, 6);
	const wrongV4Capabilities = structuredClone(v4ReceiptValue);
	wrongV4Capabilities.build.compileProtocol.capabilities = ['go-embed-objects', 'target-cgo-c'];
	const wrongV4Receipt = new TextEncoder().encode(JSON.stringify(wrongV4Capabilities));
	await assert.rejects(
		verifyTinyGoUpstreamAssetSet({
			manifest: {
				...manifest,
				producerReceipt: await evidence('producer-receipt.json', wrongV4Receipt)
			},
			producerReceipt: wrongV4Receipt,
			packageGraphReceipt,
			compiler,
			packageGraph,
			rootArchive,
			lld
		}),
		/compile protocol differs from v4/u
	);
	const ambiguousReceipt = new TextEncoder().encode(
		JSON.stringify({ ...v2ReceiptValue, schemaVersion: 1 })
	);
	await assert.rejects(
		verifyTinyGoUpstreamAssetSet({
			manifest: {
				...manifest,
				producerReceipt: await evidence('producer-receipt.json', ambiguousReceipt)
			},
			producerReceipt: ambiguousReceipt,
			packageGraphReceipt,
			compiler,
			packageGraph,
			rootArchive,
			lld
		}),
		/unexpected TinyGo producer receipt format/u
	);
	await assert.rejects(
		verifyTinyGoUpstreamAssetSet({
			manifest,
			producerReceipt,
			packageGraphReceipt,
			compiler: new Uint8Array([1, 2, 4]),
			packageGraph,
			rootArchive,
			lld
		}),
		/TinyGo compiler SHA-256 differs/
	);
});

test('accepts only the registered upstream TinyGo link plan and runtime closure', () => {
	const runtime = runtimeClosure();
	const plan = validLinkPlan(runtime);
	assert.equal(validateTinyGoLinkPlan(plan, runtime).linker, 'wasm-ld');
	assert.throws(
		() =>
			validateTinyGoLinkPlan(
				{ ...plan, arguments: [...plan.arguments, '/host/cache/object.o'] },
				runtime
			),
		/unregistered absolute path/
	);
	assert.throws(
		() =>
			validateTinyGoLinkPlan(
				{ ...plan, arguments: [...plan.arguments, '--thinlto-cache-dir=/tmp/cache'] },
				runtime
			),
		/forbidden --thinlto-cache-dir/
	);
});

test('binds compile protocol v2 objects to the compiler and go:embed package graph', () => {
	const runtime = runtimeClosure();
	const plan = validLinkPlanV2(runtime);
	const expectedEmbedObjects = plan.objects.slice(1).map((object) => ({
		importPath: object.importPath as string,
		sourcePath: object.sourcePath as string,
		sourceSha256: object.sourceSha256 as string,
		embeddedFileHash: object.embeddedFileHash as string
	}));
	assert.equal(
		validateTinyGoLinkPlanV2(plan, runtime, {
			compilerSha256: sha,
			expectedEmbedObjects
		}).objects.length,
		2
	);
	assert.throws(
		() =>
			validateTinyGoLinkPlanV2({ ...plan, compilerSha256: 'f'.repeat(64) }, runtime, {
				compilerSha256: sha,
				expectedEmbedObjects
			}),
		/identity differs from compile protocol v2/u
	);
	assert.throws(
		() =>
			validateTinyGoLinkPlanV2(
				{
					...plan,
					objects: [plan.objects[0], { ...plan.objects[1], sourcePath: '../escape' }]
				},
				runtime,
				{ compilerSha256: sha, expectedEmbedObjects }
			),
		/differs from the package graph/u
	);
	assert.throws(
		() =>
			validateTinyGoLinkPlanV2(
				{ ...plan, arguments: [...plan.arguments, 'objects/undeclared.o'] },
				runtime,
				{ compilerSha256: sha, expectedEmbedObjects }
			),
		/arguments differ from compile protocol v2/u
	);
});

test('binds compile protocol v3 CGo sources, C bitcode, dependencies, and LLD order', async () => {
	const runtime = runtimeClosure();
	const root: TinyGoWasiDirectoryContents = new Map();
	const workspace: TinyGoWasiDirectoryContents = new Map();
	const cgoBytes = new Uint8Array([1]);
	const cBytes = new Uint8Array([2]);
	const dependencyBytes = new Uint8Array([3]);
	addTinyGoVfsFile(workspace, 'native.go', cgoBytes);
	addTinyGoVfsFile(workspace, 'helper.c', cBytes);
	addTinyGoVfsFile(workspace, 'native.h', dependencyBytes);
	const cgoSha256 = await sha256TinyGoBytes(cgoBytes);
	const cSha256 = await sha256TinyGoBytes(cBytes);
	const dependencySha256 = await sha256TinyGoBytes(dependencyBytes);
	const plan = validLinkPlanV3(runtime, {
		cgoSha256,
		cSha256,
		dependencySha256
	});
	const expectedEmbedObjects = plan.objects
		.filter((object) => object.kind === 'embed')
		.map((object) => ({
			importPath: object.importPath as string,
			sourcePath: object.sourcePath as string,
			sourceSha256: object.sourceSha256 as string,
			embeddedFileHash: object.embeddedFileHash as string
		}));
	const validationOptions = {
		compilerSha256: sha,
		expectedEmbedObjects,
		expectedCGoInputs: [
			{
				importPath: 'example.com/app',
				sourcePath: 'native.go',
				bytes: cgoBytes.byteLength,
				sha256: cgoSha256
			}
		],
		expectedCObjects: [
			{
				importPath: 'example.com/app',
				sourcePath: 'helper.c',
				bytes: cBytes.byteLength,
				sha256: cSha256
			}
		],
		root,
		workspace
	};
	assert.equal(
		(await validateTinyGoLinkPlanV3(plan, runtime, validationOptions)).objects.length,
		3
	);

	const reordered = structuredClone(plan);
	const targetIndex = reordered.arguments.indexOf('objects/0001-target-c.bc');
	const wasiIndex = reordered.arguments.indexOf(reordered.runtimeInputs.at(-1)!.path);
	[reordered.arguments[targetIndex], reordered.arguments[wasiIndex]] = [
		reordered.arguments[wasiIndex],
		reordered.arguments[targetIndex]
	];
	await assert.rejects(
		validateTinyGoLinkPlanV3(reordered, runtime, validationOptions),
		/arguments differ from compile protocol v3/u
	);

	const tamperedDependency = structuredClone(plan);
	tamperedDependency.cgoInputs[0].dependencies[0].sha256 = 'f'.repeat(64);
	await assert.rejects(
		validateTinyGoLinkPlanV3(tamperedDependency, runtime, validationOptions),
		/dependency differs from workspace:native\.h/u
	);
});

test('binds compile protocol v4 C++, Clang assembly, dependencies, formats, and native link order', async () => {
	const runtime = runtimeClosure();
	const root: TinyGoWasiDirectoryContents = new Map();
	const workspace: TinyGoWasiDirectoryContents = new Map();
	const cgoBytes = new Uint8Array([1]);
	const cBytes = new Uint8Array([2]);
	const cxxBytes = new Uint8Array([3]);
	const assemblyBytes = new Uint8Array([4]);
	const dependencyBytes = new Uint8Array([5]);
	addTinyGoVfsFile(workspace, 'native.go', cgoBytes);
	addTinyGoVfsFile(workspace, 'helper.c', cBytes);
	addTinyGoVfsFile(workspace, 'helper.cc', cxxBytes);
	addTinyGoVfsFile(workspace, 'add.S', assemblyBytes);
	addTinyGoVfsFile(workspace, 'native.h', dependencyBytes);
	const cgoSha256 = await sha256TinyGoBytes(cgoBytes);
	const cSha256 = await sha256TinyGoBytes(cBytes);
	const cxxSha256 = await sha256TinyGoBytes(cxxBytes);
	const assemblySha256 = await sha256TinyGoBytes(assemblyBytes);
	const dependencySha256 = await sha256TinyGoBytes(dependencyBytes);
	const plan = validLinkPlanV4(runtime, {
		cgoSha256,
		cSha256,
		cxxSha256,
		assemblySha256,
		dependencySha256
	});
	const expectedEmbedObjects = plan.objects
		.filter((object) => object.kind === 'embed')
		.map((object) => ({
			importPath: object.importPath as string,
			sourcePath: object.sourcePath as string,
			sourceSha256: object.sourceSha256 as string,
			embeddedFileHash: object.embeddedFileHash as string
		}));
	const validationOptions = {
		compilerSha256: sha,
		expectedEmbedObjects,
		expectedCGoInputs: [
			{
				importPath: 'example.com/app',
				sourcePath: 'native.go',
				bytes: cgoBytes.byteLength,
				sha256: cgoSha256
			}
		],
		expectedNativeObjects: [
			{
				importPath: 'example.com/app',
				sourceField: 'CFiles' as const,
				sourcePath: 'helper.c',
				bytes: cBytes.byteLength,
				sha256: cSha256
			},
			{
				importPath: 'example.com/app',
				sourceField: 'CXXFiles' as const,
				sourcePath: 'helper.cc',
				bytes: cxxBytes.byteLength,
				sha256: cxxSha256
			},
			{
				importPath: 'example.com/app',
				sourceField: 'SFiles' as const,
				sourcePath: 'add.S',
				bytes: assemblyBytes.byteLength,
				sha256: assemblySha256
			}
		],
		root,
		workspace
	};
	assert.equal(
		(await validateTinyGoLinkPlanV4(plan, runtime, validationOptions)).objects.length,
		5
	);

	const reordered = structuredClone(plan);
	const assemblyIndex = reordered.arguments.indexOf('objects/0003-target-assembly.o');
	const wasiIndex = reordered.arguments.indexOf(reordered.runtimeInputs.at(-1)!.path);
	[reordered.arguments[assemblyIndex], reordered.arguments[wasiIndex]] = [
		reordered.arguments[wasiIndex],
		reordered.arguments[assemblyIndex]
	];
	await assert.rejects(
		validateTinyGoLinkPlanV4(reordered, runtime, validationOptions),
		/arguments differ from compile protocol v4/u
	);

	const wrongCXXFormat = structuredClone(plan);
	wrongCXXFormat.objects[2].format = 'wasm-object';
	await assert.rejects(
		validateTinyGoLinkPlanV4(wrongCXXFormat, runtime, validationOptions),
		/object 2 is invalid/u
	);

	const wrongLLVMTarget = structuredClone(plan);
	wrongLLVMTarget.objects[2].llvmValidation!.targetTriple = 'wasm32-unknown-unknown' as never;
	await assert.rejects(
		validateTinyGoLinkPlanV4(wrongLLVMTarget, runtime, validationOptions),
		/lacks exact LLVM validation evidence/u
	);

	const unverifiedLLVM = structuredClone(plan);
	unverifiedLLVM.objects[1].llvmValidation!.moduleVerified = false as never;
	await assert.rejects(
		validateTinyGoLinkPlanV4(unverifiedLLVM, runtime, validationOptions),
		/lacks exact LLVM validation evidence/u
	);

	const fakeAssemblyEvidence = structuredClone(plan);
	fakeAssemblyEvidence.objects[3].wasmValidation!.linkingVersion = 1 as never;
	await assert.rejects(
		validateTinyGoLinkPlanV4(fakeAssemblyEvidence, runtime, validationOptions),
		/lacks exact Wasm validation evidence/u
	);

	const lowercaseAssembly = structuredClone(plan);
	lowercaseAssembly.objects[3].sourcePath = 'add.s';
	await assert.rejects(
		validateTinyGoLinkPlanV4(lowercaseAssembly, runtime, validationOptions),
		/native object 3 differs from the package graph/u
	);

	const tamperedDependency = structuredClone(plan);
	tamperedDependency.objects[2].dependencies![0].sha256 = 'f'.repeat(64);
	await assert.rejects(
		validateTinyGoLinkPlanV4(tamperedDependency, runtime, validationOptions),
		/dependency differs from workspace:native\.h/u
	);

	const hostedPlan = validLinkPlanV5(runtime, {
		cgoSha256,
		cSha256,
		cxxSha256,
		assemblySha256,
		dependencySha256
	});
	assert.equal(
		(await validateTinyGoLinkPlanV5(hostedPlan, runtime, validationOptions)).objects.length,
		5
	);
	const missingLibCxxAbi = structuredClone(hostedPlan);
	missingLibCxxAbi.runtimeInputs = missingLibCxxAbi.runtimeInputs.filter(
		(input) => input.kind !== 'libcxxabi'
	);
	await assert.rejects(
		validateTinyGoLinkPlanV5(missingLibCxxAbi, runtime, validationOptions),
		/runtimeInputs do not match the runtime closure/u
	);
	const reorderedHostedRuntime = structuredClone(hostedPlan);
	const libcxxIndex = reorderedHostedRuntime.arguments.indexOf(
		`${TINYGO_ROOT_PATH}/${runtime.libCxx!.path}`
	);
	const libcxxabiIndex = reorderedHostedRuntime.arguments.indexOf(
		`${TINYGO_ROOT_PATH}/${runtime.libCxxAbi!.path}`
	);
	[
		reorderedHostedRuntime.arguments[libcxxIndex],
		reorderedHostedRuntime.arguments[libcxxabiIndex]
	] = [
		reorderedHostedRuntime.arguments[libcxxabiIndex],
		reorderedHostedRuntime.arguments[libcxxIndex]
	];
	await assert.rejects(
		validateTinyGoLinkPlanV5(reorderedHostedRuntime, runtime, validationOptions),
		/arguments differ from compile protocol v5/u
	);

	const flaggedPlan = validLinkPlanV6(runtime, {
		cgoSha256,
		cSha256,
		cxxSha256,
		assemblySha256,
		dependencySha256
	});
	assert.equal(
		(
			await validateTinyGoLinkPlanV6(flaggedPlan, runtime, {
				...validationOptions,
				expectedCXXFlags: new Map([['example.com/app\0helper.cc', ['-DCPP_VALUE=7']]]),
				expectedCGoLinkerFlags: ['-lexample']
			})
		).schemaVersion,
		6
	);
	const workspaceRootLibraryPlan = structuredClone(flaggedPlan);
	workspaceRootLibraryPlan.cgoLinkerFlags = ['-L/workspace'];
	workspaceRootLibraryPlan.arguments[workspaceRootLibraryPlan.arguments.indexOf('-lexample')] =
		'-L/workspace';
	assert.equal(
		(
			await validateTinyGoLinkPlanV6(workspaceRootLibraryPlan, runtime, {
				...validationOptions,
				expectedCXXFlags: new Map([['example.com/app\0helper.cc', ['-DCPP_VALUE=7']]]),
				expectedCGoLinkerFlags: ['-L/workspace']
			})
		).schemaVersion,
		6
	);
	const unsafeLinkerFlag = structuredClone(flaggedPlan);
	unsafeLinkerFlag.cgoLinkerFlags = ['--export-all'];
	unsafeLinkerFlag.arguments[unsafeLinkerFlag.arguments.indexOf('-lexample')] = '--export-all';
	await assert.rejects(
		validateTinyGoLinkPlanV6(unsafeLinkerFlag, runtime, {
			...validationOptions,
			expectedCXXFlags: new Map([['example.com/app\0helper.cc', ['-DCPP_VALUE=7']]]),
			expectedCGoLinkerFlags: ['--export-all']
		}),
		/outside the browser library-link policy/u
	);
});

test('preserves distinct embed objects that have duplicate source contents', () => {
	const runtime = runtimeClosure();
	const basePlan = validLinkPlanV2(runtime);
	const duplicateObject = {
		...basePlan.objects[1],
		path: 'objects/0002-embed.o',
		sha256: '4'.repeat(64),
		importPath: 'example.com/dependency',
		sourcePath: 'copy.txt'
	};
	const objects = [...basePlan.objects, duplicateObject];
	const linkArguments = [...basePlan.arguments];
	linkArguments.splice(
		linkArguments.indexOf(basePlan.runtimeInputs[0].path),
		0,
		duplicateObject.path
	);
	const plan = { ...basePlan, objects, arguments: linkArguments };
	const expectedEmbedObjects = objects.slice(1).map((object) => ({
		importPath: object.importPath as string,
		sourcePath: object.sourcePath as string,
		sourceSha256: object.sourceSha256 as string,
		embeddedFileHash: object.embeddedFileHash as string
	}));

	assert.equal(
		validateTinyGoLinkPlanV2(plan, runtime, {
			compilerSha256: sha,
			expectedEmbedObjects
		}).objects.length,
		3
	);
});

test('Binaryen adapter runs asyncify and O1 while restoring global settings', async () => {
	const calls: string[] = [];
	const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
	let optimizeLevel = 3;
	let shrinkLevel = 2;
	let debugInfo = false;
	const binaryen: TinyGoBinaryenLike = {
		readBinary(bytes) {
			assert.deepEqual(bytes, binary);
			return {
				runPasses(passes) {
					calls.push(`passes:${passes.join(',')}`);
				},
				optimize() {
					calls.push('optimize');
				},
				validate: () => true,
				emitBinary: () => binary,
				dispose() {
					calls.push('dispose');
				}
			};
		},
		getOptimizeLevel: () => optimizeLevel,
		setOptimizeLevel(value) {
			const previous = optimizeLevel;
			optimizeLevel = value;
			return previous;
		},
		getShrinkLevel: () => shrinkLevel,
		setShrinkLevel(value) {
			const previous = shrinkLevel;
			shrinkLevel = value;
			return previous;
		},
		getDebugInfo: () => debugInfo,
		setDebugInfo(value) {
			debugInfo = value;
		}
	};
	const optimize = createBinaryenTinyGoOptimizer(binaryen);
	assert.deepEqual(
		await optimize({
			wasm: binary,
			arguments: ['--asyncify', '-O1', '-g'],
			passes: ['asyncify'],
			optimizeLevel: 1,
			preserveDebugInfo: true
		}),
		binary
	);
	assert.deepEqual(calls, ['passes:asyncify', 'optimize', 'dispose']);
	assert.equal(optimizeLevel, 3);
	assert.equal(shrinkLevel, 2);
	assert.equal(debugInfo, false);
});
