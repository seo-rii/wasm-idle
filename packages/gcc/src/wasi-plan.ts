import { gccCompileInputs } from './plan.js';
import type { CrossGccTool, WasiGccCompileRequest, WasiGccManifest } from './types.js';

const unavailableFeatures = ['exceptions', 'rtti', 'threads', 'dynamicLinking', 'simd'] as const;

/** GCC emits WAT; patched WABT emits relocatable Wasm; LLVM is used only as the linker. */
export function wasiGccCompilePlan(request: WasiGccCompileRequest, manifest: WasiGccManifest) {
	const { language, emit, optimization, standard, main, files, sources, definitions } =
		gccCompileInputs(
			request,
			['cpu', ...unavailableFeatures],
			[
				'program.wat',
				'program.wasm',
				...Array.from({ length: 63 }, (_, i) => `program.${i + 1}.wat`)
			]
		);
	if (request.cpu !== undefined && request.cpu !== 'wasm32')
		throw new Error('GCC wasm32-wasi supports only cpu=wasm32; x86 AVX2/FMA is not Wasm SIMD');
	for (const feature of unavailableFeatures)
		if (request[feature] !== undefined && request[feature] !== false)
			throw new Error(`GCC wasm32-wasi does not support ${feature}`);
	if (language === 'cpp' && !manifest.capabilities.cpp)
		throw new Error('This GCC wasm32-wasi bundle does not support C++');
	if (emit === 'executable' && (!manifest.capabilities.libc || !manifest.capabilities.libm))
		throw new Error('This GCC wasm32-wasi bundle cannot link WASI libc and libm executables');
	const cc = [
		'-quiet',
		`-O${optimization}`,
		`-std=${standard}`,
		'-fdiagnostics-color=never',
		'-Werror=attributes',
		'-Werror=pragmas',
		'-D__GCC_WASI_SINGLE_THREAD__=1',
		...definitions
	];
	if (language === 'cpp')
		cc.push('-fno-exceptions', '-fno-rtti', '-fuse-cxa-atexit', '-fno-threadsafe-statics');
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
	const stages: { tool: CrossGccTool; argv: string[]; output: string }[] = [];
	const objects: string[] = [];
	for (const [index, source] of [main, ...sources].entries()) {
		const stem = index === 0 ? 'program' : `program.${index}`;
		const assembly = `/workspace/${stem}.wat`;
		stages.push({
			tool: language === 'c' ? 'cc1' : 'cc1plus',
			argv: [...cc, `/workspace/${source}`, '-o', assembly],
			output: assembly
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
				...(language === 'cpp' && manifest.capabilities.libstdcxx ? ['-lstdc++'] : []),
				'-lm',
				'-lc',
				...manifest.runtimeLibraries
			],
			output: '/workspace/program.wasm'
		});
	}
	return {
		files,
		stages,
		cpu: 'wasm32' as const,
		emit,
		fileName: stages.at(-1)!.output.split('/').at(-1)!
	};
}
