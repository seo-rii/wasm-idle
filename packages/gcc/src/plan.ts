import type { CrossGccCompileRequest, CrossGccManifest, CrossGccTool } from './types.js';

const encoder = new TextEncoder();
const maxWorkspaceBytes = 16 * 1024 * 1024;
const requestKeys = new Set([
	'code',
	'language',
	'cpu',
	'emit',
	'optimization',
	'standard',
	'preprocessed',
	'files',
	'sources'
]);
const reservedNames = new Set([
	'main.c',
	'main.cpp',
	'main.i',
	'main.ii',
	'program.s',
	'program.o',
	'program.elf'
]);

export function gccRelativePath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 4096 ||
		/[\\\x00-\x1f]/u.test(value) ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid GCC relative path');
	return value;
}

/** No fork/exec and no source rewriting: the Worker explicitly schedules these real GNU tools. */
export function gccCompilePlan(request: CrossGccCompileRequest, manifest: CrossGccManifest) {
	if (!request || typeof request !== 'object' || typeof request.code !== 'string')
		throw new Error('GCC requires source text');
	if (Object.keys(request).some((key) => !requestKeys.has(key)))
		throw new Error('Unsupported GCC option; use the documented compile request fields');
	const language = request.language ?? 'cpp',
		cpu = request.cpu ?? 'x86-64';
	const emit = request.emit ?? 'executable',
		optimization = request.optimization ?? '2';
	// AVX2 without FMA is a subset of the existing producer v1 capability.
	// Keep accepting the pinned manifest unchanged; do not invent producer metadata.
	if (
		!['c', 'cpp'].includes(language) ||
		!manifest.cpuProfiles.includes(cpu === 'avx2' ? 'avx2-fma' : cpu) ||
		!['assembly', 'object', 'executable'].includes(emit) ||
		!['0', '1', '2', '3', 's'].includes(optimization)
	)
		throw new Error('Invalid GCC compilation profile');
	if (request.preprocessed !== undefined && typeof request.preprocessed !== 'boolean')
		throw new Error('Invalid GCC preprocessed option');
	if (
		request.sources !== undefined &&
		(!Array.isArray(request.sources) || request.sources.length > 63)
	)
		throw new Error('GCC supports at most 63 additional translation units');
	const sources = (request.sources ?? []).map(gccRelativePath);
	if (new Set(sources).size !== sources.length) throw new Error('Duplicate GCC translation unit');
	if (sources.length && emit !== 'executable')
		throw new Error('Additional GCC translation units require executable output');
	const reserved = new Set(reservedNames);
	for (let i = 1; i <= sources.length; i++) {
		reserved.add(`program.${i}.s`);
		reserved.add(`program.${i}.o`);
	}
	const standard = request.standard ?? (language === 'c' ? 'gnu17' : 'gnu++20');
	const standards =
		language === 'c'
			? ['c99', 'gnu99', 'c11', 'gnu11', 'c17', 'gnu17', 'c2x', 'gnu2x']
			: [
					'c++11',
					'gnu++11',
					'c++14',
					'gnu++14',
					'c++17',
					'gnu++17',
					'c++20',
					'gnu++20',
					'c++23',
					'gnu++23'
				];
	if (!standards.includes(standard)) throw new Error('Unsupported GCC language standard');
	const main = request.preprocessed
		? language === 'c'
			? 'main.i'
			: 'main.ii'
		: language === 'c'
			? 'main.c'
			: 'main.cpp';
	const code = encoder.encode(request.code);
	let totalBytes = code.length;
	if (
		totalBytes > maxWorkspaceBytes ||
		(request.files && (!Array.isArray(request.files) || request.files.length > 1024))
	)
		throw new Error('GCC workspace exceeds its limit');
	const files = [{ path: `/workspace/${main}`, contents: code }];
	const paths = new Set<string>();
	for (const file of request.files ?? []) {
		const path = gccRelativePath(file.path);
		if (reserved.has(path.split('/')[0])) throw new Error('GCC input/output path is reserved');
		if (paths.has(path)) throw new Error('Duplicate GCC workspace file');
		for (const existing of paths) {
			if (existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`))
				throw new Error('GCC workspace file/directory collision');
		}
		paths.add(path);
		if (typeof file.contents !== 'string' && !(file.contents instanceof Uint8Array))
			throw new Error('Invalid GCC workspace contents');
		const contents =
			typeof file.contents === 'string'
				? encoder.encode(file.contents)
				: Uint8Array.from(file.contents);
		totalBytes += contents.length;
		if (totalBytes > maxWorkspaceBytes) throw new Error('GCC workspace exceeds its limit');
		files.push({ path: `/workspace/${path}`, contents });
	}
	for (const source of sources) {
		if (!paths.has(source)) throw new Error(`Missing GCC translation unit: ${source}`);
	}
	const cc = [
		'-quiet',
		'-m64',
		'-march=x86-64',
		'-mtune=generic',
		`-O${optimization}`,
		`-std=${standard}`,
		'-fno-pie',
		'-fasynchronous-unwind-tables',
		'-fdiagnostics-color=never'
	];
	if (cpu === 'avx2') cc.push('-mavx2', '-mno-fma');
	else if (cpu === 'avx2-fma') cc.push('-mavx2', '-mfma');
	if (language === 'cpp') cc.push('-fexceptions');
	if (request.preprocessed) cc.push('-fpreprocessed');
	else {
		cc.push('-nostdinc', '-isysroot', manifest.sysrootPath);
		const includes = [];
		if (language === 'cpp') {
			cc.push('-D_GNU_SOURCE');
			includes.push(
				'/sysroot/usr/include/c++/16',
				'/sysroot/usr/include/x86_64-linux-gnu/c++/16',
				'/sysroot/usr/include/c++/16/backward'
			);
		}
		includes.push(
			manifest.resourceDir,
			`${manifest.gccInstallation}/include-fixed`,
			'/sysroot/usr/include/x86_64-linux-gnu',
			'/sysroot/usr/include'
		);
		for (const include of includes) cc.push('-isystem', include);
	}
	const stages: { tool: CrossGccTool; argv: string[]; output: string }[] = [];
	const objects: string[] = [];
	for (const [index, source] of [main, ...sources].entries()) {
		const stem = index === 0 ? 'program' : `program.${index}`;
		const assembly = `/workspace/${stem}.s`;
		stages.push({
			tool: language === 'c' ? 'cc1' : 'cc1plus',
			argv: [...cc, `/workspace/${source}`, '-o', assembly],
			output: assembly
		});
		if (emit !== 'assembly') {
			const object = `/workspace/${stem}.o`;
			stages.push({
				tool: 'as',
				argv: ['--64', '-o', object, assembly],
				output: object
			});
			objects.push(object);
		}
	}
	if (emit === 'executable') {
		const gcc = manifest.gccInstallation,
			lib = '/sysroot/usr/lib/x86_64-linux-gnu';
		stages.push({
			tool: 'ld',
			argv: [
				'-m',
				'elf_x86_64',
				'--sysroot=/sysroot',
				'-static',
				'-o',
				'/workspace/program.elf',
				`${lib}/crt1.o`,
				`${lib}/crti.o`,
				`${gcc}/crtbeginT.o`,
				`-L${gcc}`,
				`-L${lib}`,
				'-L/sysroot/lib/x86_64-linux-gnu',
				...objects,
				...(language === 'cpp' ? ['-lstdc++'] : []),
				'-lm',
				'--start-group',
				'-lgcc',
				'-lgcc_eh',
				'-lc',
				'--end-group',
				`${gcc}/crtend.o`,
				`${lib}/crtn.o`
			],
			output: '/workspace/program.elf'
		});
	}
	return { files, stages, cpu, emit, fileName: stages.at(-1)!.output.split('/').at(-1)! };
}
