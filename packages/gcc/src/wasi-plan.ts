import { gccCompileInputs } from './plan.js';
import { supportsGccWasmSimd } from './wasm-output.js';
import { snapshotWasiGccLinkInputs } from './wasm-link-inputs.js';
import type { CrossGccTool, WasiGccCompileRequest, WasiGccManifest } from './types.js';

const unavailableFeatures = ['exceptions', 'threads', 'dynamicLinking'] as const;

/** GCC emits WAT; patched WABT emits relocatable Wasm; LLVM is used only as the linker. */
export function wasiGccCompilePlan(request: WasiGccCompileRequest, manifest: WasiGccManifest) {
	const { language, emit, optimization, standard, main, files, sources, definitions } =
		gccCompileInputs(
			request,
			['cpu', 'simd', 'rtti', 'coverage', 'debug', 'linkInputs', ...unavailableFeatures],
			[
				'program.wat',
				'program.wasm',
				...(request?.coverage === true
					? Array.from({ length: 64 }, (_, i) => `program${i ? `.${i}` : ''}.gcno`)
					: []),
				...Array.from({ length: 63 }, (_, i) => `program.${i + 1}.wat`)
			],
			manifest.capabilities.debugger === true
		);
	if (
		(standard === 'c++26' || standard === 'gnu++26') &&
		manifest.qualification.status !== 'verified'
	)
		throw new Error('C++26 requires a qualified GCC WASI debugger bundle');
	if (request.debug !== undefined && typeof request.debug !== 'boolean')
		throw new Error('Invalid GCC WASI debug option');
	const debug = request.debug === true;
	if (debug) {
		if (!manifest.capabilities.debug)
			throw new Error('This GCC wasm32-wasi bundle does not support DWARF debug information');
		if (manifest.qualification.status !== 'verified')
			throw new Error('GCC WASI debug requires a qualified bundle');
		if (request.optimization !== undefined && optimization !== '0')
			throw new Error('GCC WASI debug currently requires optimization=0');
	}
	const linkInputs = snapshotWasiGccLinkInputs(request.linkInputs);
	if (linkInputs.length && emit !== 'executable')
		throw new Error('Explicit GCC link inputs require executable output');
	if (request.coverage !== undefined && typeof request.coverage !== 'boolean')
		throw new Error('Invalid GCC WASI coverage option');
	const coverage = request.coverage === true;
	if (coverage) {
		if (!manifest.capabilities.coverage)
			throw new Error('This GCC wasm32-wasi bundle does not support coverage');
		if (linkInputs.length)
			throw new Error(
				'GCC WASI coverage currently requires source-only compilation without linkInputs'
			);
	}
	if (request.cpu !== undefined && request.cpu !== 'wasm32')
		throw new Error('GCC wasm32-wasi supports only cpu=wasm32; x86 AVX2/FMA is not Wasm SIMD');
	for (const feature of unavailableFeatures)
		if (request[feature] !== undefined && request[feature] !== false)
			throw new Error(`GCC wasm32-wasi does not support ${feature}`);
	if (request.rtti !== undefined && typeof request.rtti !== 'boolean')
		throw new Error('Invalid GCC WASI RTTI option');
	if (request.rtti === true) {
		if (language !== 'cpp') throw new Error('GCC WASI RTTI requires a C++ source request');
		if (!manifest.capabilities.rtti)
			throw new Error('This GCC wasm32-wasi bundle does not support RTTI');
	}
	if (request.simd !== undefined && typeof request.simd !== 'boolean')
		throw new Error('Invalid GCC WASI SIMD option');
	if (request.simd) {
		if (!manifest.capabilities.simd)
			throw new Error('This GCC wasm32-wasi bundle does not support Wasm SIMD');
		if (!supportsGccWasmSimd())
			throw new Error('This WebAssembly engine does not support Wasm SIMD');
	}
	if (language === 'cpp' && !manifest.capabilities.cpp)
		throw new Error('This GCC wasm32-wasi bundle does not support C++');
	if (emit === 'executable' && (!manifest.capabilities.libc || !manifest.capabilities.libm))
		throw new Error('This GCC wasm32-wasi bundle cannot link WASI libc and libm executables');
	const cc = [
		'-quiet',
		`-O${debug ? '0' : optimization}`,
		`-std=${standard}`,
		'-fdiagnostics-color=never',
		'-Werror=attributes',
		'-Werror=pragmas',
		'-D__GCC_WASI_SINGLE_THREAD__=1',
		...definitions
	];
	if (debug) cc.push('-g', '-gdwarf-4', '-gno-variable-location-views');
	// Legacy scalar bundles do not recognize either flag; leave their argv unchanged.
	if (manifest.capabilities.simd) cc.push(request.simd ? '-msimd128' : '-mno-simd128');
	if (coverage)
		cc.push(
			'-fprofile-arcs',
			'-ftest-coverage',
			'-fprofile-update=single',
			'-fprofile-dir=/profile',
			'-fprofile-prefix-path=/workspace'
		);
	if (language === 'cpp')
		cc.push(
			'-fno-exceptions',
			request.rtti === true ? '-frtti' : '-fno-rtti',
			'-fuse-cxa-atexit',
			'-fno-threadsafe-statics'
		);
	if (request.preprocessed) cc.push('-fpreprocessed');
	else {
		cc.push('-nostdinc', '-isysroot', manifest.sysrootPath);
		const includes: string[] = [];
		if (language === 'cpp' && manifest.capabilities.libstdcxx) {
			const cxx = `/sysroot/include/c++/${manifest.compiler.version}`;
			includes.push(cxx, `${cxx}/wasm32-wasi`, `${cxx}/backward`);
		}
		includes.push(manifest.resourceDir, '/sysroot/include/wasm32-wasi', '/sysroot/include');
		for (const include of includes) cc.push('-isystem', include);
	}
	const stages: {
		tool: CrossGccTool;
		argv: string[];
		output: string;
		coverageNote?: { path: string; dataPath: string };
	}[] = [];
	const objects: string[] = [];
	for (const [index, source] of [main, ...sources].entries()) {
		const stem = index === 0 ? 'program' : `program.${index}`;
		const assembly = `/workspace/${stem}.wat`;
		const extension = language === 'c' ? '.c' : '.cpp';
		stages.push({
			tool: language === 'c' ? 'cc1' : 'cc1plus',
			argv: [
				...cc,
				...(coverage
					? ['-dumpbase', `${stem}${extension}`, '-dumpbase-ext', extension]
					: []),
				`/workspace/${source}`,
				'-o',
				assembly
			],
			output: assembly,
			...(coverage
				? { coverageNote: { path: `${stem}.gcno`, dataPath: `/profile/${stem}.gcda` } }
				: {})
		});
		if (emit !== 'assembly') {
			const object = `/workspace/${stem}.o`;
			stages.push({
				tool: 'as',
				argv: ['-r', '--enable-annotations', assembly, '-o', object],
				output: object
			});
			objects.push(object);
		}
	}
	if (emit === 'executable') {
		const lib = '/sysroot/lib/wasm32-wasi';
		stages.push({
			tool: 'ld',
			argv: [
				'--fatal-warnings',
				...(manifest.capabilities.debugger
					? ['--export-if-defined=_ZN9__gnu_cxx30debugger_signal_for_breakpointE']
					: []),
				'-m',
				'wasm32',
				'-e',
				'_start',
				'-o',
				'/workspace/program.wasm',
				`${lib}/crt1-command.o`,
				`-L${lib}`,
				`-L${manifest.gccInstallation}`,
				...objects,
				...linkInputs.map((input) => `/link-inputs/${input.path}`),
				...(language === 'cpp' && manifest.capabilities.libstdcxx ? ['-lstdc++'] : []),
				...(manifest.capabilities.longDouble ? ['-lc-printscan-long-double'] : []),
				...(coverage ? ['-lgcov', '-lwasi-emulated-getpid'] : []),
				'-lm',
				'-lc',
				...manifest.runtimeLibraries
			],
			output: '/workspace/program.wasm'
		});
	}
	return {
		files: [
			...files,
			...linkInputs.map((input) => ({
				path: `/link-inputs/${input.path}`,
				contents: input.bytes
			}))
		],
		linkInputs,
		language,
		simd: request.simd === true,
		rtti: request.rtti === true,
		...(coverage ? { coverage: true as const } : {}),
		stages,
		cpu: 'wasm32' as const,
		emit,
		fileName: stages.at(-1)!.output.split('/').at(-1)!
	};
}
