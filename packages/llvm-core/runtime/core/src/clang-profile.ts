export const CLANG_WASI_TARGET = 'wasm32-wasi';
export const OBJECTIVE_C_RUNTIME_FLAGS = [
	'-fobjc-runtime=gnustep-2.0',
	'-fblocks'
] as const;
export const OBJECTIVE_C_LSP_DEFINES = ['-DOBJC2RUNTIME=1'] as const;
const defaultCppStandardArg = '-std=gnu++20';
const defaultCStandardArg = '-std=gnu11';

export type ClangSourceLanguage = 'C' | 'CPP' | 'OBJC';

function normalizeStandardCode(value?: string) {
	return (value || '').trim().toUpperCase().replaceAll(/\s+/g, '');
}

function resolveCppStandardArg(version?: string) {
	switch (normalizeStandardCode(version)) {
		case '03':
		case 'CPP03':
		case 'C++03':
		case 'GNU++03':
		case 'GNUC++03':
			return '-std=gnu++03';
		case '11':
		case 'CPP11':
		case 'C++11':
		case 'GNU++11':
		case 'GNUC++11':
			return '-std=gnu++11';
		case '14':
		case 'CPP14':
		case 'C++14':
		case 'GNU++14':
		case 'GNUC++14':
			return '-std=gnu++14';
		case '17':
		case 'CPP17':
		case 'C++17':
		case 'GNU++17':
		case 'GNUC++17':
			return '-std=gnu++17';
		case '20':
		case 'CPP20':
		case 'C++20':
		case 'GNU++20':
		case 'GNUC++20':
			return '-std=gnu++20';
		case '23':
		case 'CPP23':
		case 'C++23':
		case 'GNU++23':
		case 'GNUC++23':
			return '-std=gnu++23';
		case '26':
		case 'CPP26':
		case 'C++26':
		case 'GNU++26':
		case 'GNUC++26':
			return '-std=gnu++26';
		default:
			return defaultCppStandardArg;
	}
}

function resolveCStandardArg(version?: string) {
	switch (normalizeStandardCode(version)) {
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
