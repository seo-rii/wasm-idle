export const CLANG_WASI_TARGET = 'wasm32-wasi';
export const CLANG_WASI_DRIVER_TARGET = 'wasm32-wasip1';
export const OBJECTIVE_C_RUNTIME_FLAGS = ['-fobjc-runtime=gnustep-2.0', '-fblocks'] as const;
export const OBJECTIVE_C_LSP_DEFINES = ['-DOBJC2RUNTIME=1'] as const;
const defaultCppStandardArg = '-std=gnu++20';
const defaultCStandardArg = '-std=gnu11';

/** Workspace source siblings automatically compiled by both Clang execution backends. */
export function isClangWorkspaceTranslationUnit(path: string) {
	return /\.(?:c|C|cc|cpp|cxx)$/.test(path);
}

export type ClangSourceLanguage = 'C' | 'CPP' | 'OBJC';

/** In a multi-file build, the active editor and its siblings use the same filename rules. */
export function clangWorkspaceUnitLanguage(
	path: string,
	activePath: string,
	language: ClangSourceLanguage
) {
	if (path === activePath && (language === 'OBJC' || !isClangWorkspaceTranslationUnit(path)))
		return language;
	return path.endsWith('.c') ? 'C' : 'CPP';
}

const optionsWithValues = new Set([
	'-I',
	'-isystem',
	'-iquote',
	'-idirafter',
	'-include',
	'-include-pch',
	'-imacros',
	'-isysroot',
	'--sysroot',
	'-resource-dir',
	'-D',
	'-U',
	'-o',
	'-L',
	'-l',
	'-B',
	'-target',
	'--target',
	'-Xclang',
	'-Xpreprocessor',
	'-Xassembler',
	'-Xlinker',
	'-mllvm',
	'-MF',
	'-MT',
	'-MQ',
	'-u',
	'-T',
	'-z',
	'-framework',
	'-F',
	'-iframework',
	'-isystem-after',
	'-include-pth',
	'-gcc-toolchain',
	'--gcc-toolchain',
	'-arch'
]);

export function clangOptionTakesValue(argument: string) {
	return optionsWithValues.has(argument);
}

export function clangInputModeLanguage(mode: string) {
	if (mode === 'c' || mode === 'c-header' || mode === 'cpp-output') return 'C';
	if (mode === 'c++' || mode === 'c++-header' || mode === 'c++-cpp-output') return 'CPP';
}

export function clangWorkspaceBuildSources(
	files: { path: string; content: string }[],
	input: string,
	language: ClangSourceLanguage,
	compileArgs: string[]
) {
	const sources = files.filter(
		(file) => file.path === input || isClangWorkspaceTranslationUnit(file.path)
	);
	let override: ClangSourceLanguage | undefined;
	let explicit = false;
	let standardLanguage: ClangSourceLanguage | undefined;
	for (let index = 0; index < compileArgs.length; index++) {
		const arg = compileArgs[index];
		if (typeof arg !== 'string' || arg.startsWith('@')) {
			// Clang resolves response files. Keep the caller's active-file default when their mode is opaque.
			explicit = true;
			override = undefined;
		} else if (clangOptionTakesValue(arg)) {
			index++;
		} else if (/^--?std=/.test(arg)) {
			standardLanguage = arg.includes('++') ? 'CPP' : 'C';
		} else if (arg.startsWith('-x')) {
			const mode = arg.slice(2) || compileArgs[++index];
			explicit = true;
			override = mode === 'objective-c' ? 'OBJC' : clangInputModeLanguage(mode);
		}
	}
	// A raw standard applies to every cc1 invocation. Preserve the requested dialect when it matches.
	if (!explicit && standardLanguage === language) override = language;
	const units = sources.map((file) => ({
		...file,
		language:
			override ??
			(sources.length === 1 || (explicit && file.path === input)
				? language
				: clangWorkspaceUnitLanguage(file.path, input, language))
	}));
	return {
		units,
		cOnly: !explicit && language === 'C' && units.every((unit) => unit.language === 'C')
	};
}

function normalizeStandardCode(value?: string) {
	return (value || '').trim().toUpperCase().replaceAll(/\s+/g, '');
}

function resolveCppStandardArg(version?: string) {
	const standard = /^(?:CPP|C\+\+|GNU\+\+|GNUC\+\+)?(98|03|11|14|17|20|23|26)$/.exec(
		normalizeStandardCode(version)
	);
	return standard ? `-std=gnu++${standard[1]}` : defaultCppStandardArg;
}

function resolveCStandardArg(version?: string) {
	switch (normalizeStandardCode(version)) {
		case '89':
		case '90':
		case 'C89':
		case 'C90':
		case 'GNU89':
		case 'GNU90':
		case 'GNUC89':
		case 'GNUC90':
			return '-std=gnu89';
		case '99':
		case 'C99':
		case 'GNU99':
		case 'GNUC99':
			return '-std=gnu99';
		case '11':
		case 'C11':
		case 'GNU11':
		case 'GNUC11':
			return '-std=gnu11';
		case '17':
		case '18':
		case 'C17':
		case 'C18':
		case 'GNU17':
		case 'GNU18':
		case 'GNUC17':
		case 'GNUC18':
			return '-std=gnu17';
		case '23':
		case '2X':
		case 'C23':
		case 'C2X':
		case 'GNU23':
		case 'GNU2X':
		case 'GNUC23':
		case 'GNUC2X':
			return '-std=gnu23';
		case '2Y':
		case 'C2Y':
		case 'GNU2Y':
		case 'GNUC2Y':
			return '-std=gnu2y';
		default:
			return defaultCStandardArg;
	}
}

export function resolveClangLanguageArgs(
	language: ClangSourceLanguage,
	options: { cppVersion?: string; cVersion?: string }
) {
	if (language === 'C') {
		return {
			languageArg: 'c',
			standardArg: resolveCStandardArg(options.cVersion)
		};
	}
	if (language === 'OBJC') {
		return {
			languageArg: 'objective-c',
			standardArg: resolveCStandardArg(options.cVersion)
		};
	}

	return {
		languageArg: 'c++',
		standardArg: resolveCppStandardArg(options.cppVersion)
	};
}

/** Logical sysroot paths are shared; each host mounts its sysroot at a different root. */
export function clangSystemIncludePaths(
	language: ClangSourceLanguage | 'OBJCXX',
	root = '',
	resourceDir?: string
) {
	return [
		...(['CPP', 'OBJCXX'].includes(language)
			? [`${root}/include/c++/v1`, `${root}/include/wasm32-wasi/c++/v1`]
			: []),
		...(resourceDir ? [`${resourceDir.replace(/\/+$/, '')}/include`] : []),
		`${root}/include/wasm32-wasi`,
		`${root}/include`
	];
}
