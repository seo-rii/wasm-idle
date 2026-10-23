import {
	CLANG_WASI_DRIVER_TARGET,
	OBJECTIVE_C_LSP_DEFINES,
	OBJECTIVE_C_RUNTIME_FLAGS,
	clangSystemIncludePaths,
	resolveClangLanguageArgs,
	type ClangSourceLanguage
} from '@wasm-idle/llvm-core/core/clang-profile';
export const CLANGD_WORKSPACE_PATH = '/workspace';
export const CLANGD_WORKSPACE_URI = `file://${CLANGD_WORKSPACE_PATH}`;
export const CLANGD_CPP_FILE_PATH = `${CLANGD_WORKSPACE_PATH}/main.cpp`;
export const CLANGD_CPP_FILE_URI = `file://${CLANGD_CPP_FILE_PATH}`;

export type ClangdStatus =
	| { state: 'disabled' }
	| { state: 'loading'; stage?: string; loaded?: number; total?: number }
	| { state: 'ready' }
	| { state: 'error'; message: string };

export const normalizeClangdBaseUrl = (baseUrl: string) =>
	baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

export type ClangdSourceLanguage = ClangSourceLanguage | 'OBJCXX';

export interface ClangdCompileProfile {
	cppVersion?: string;
	cVersion?: string;
	compileArgs?: string[];
	sourceLanguage?: ClangdSourceLanguage;
}

export const createClangdCompileFlags = (
	language: ClangdSourceLanguage = 'CPP',
	options: ClangdCompileProfile & { resourceDir?: string } = {}
) => {
	// Objective-C++ uses the C++ standard selection with the Objective-C runtime ABI.
	const profile =
		language === 'OBJCXX'
			? {
					...resolveClangLanguageArgs('CPP', options),
					languageArg: 'objective-c++'
				}
			: resolveClangLanguageArgs(language, options);
	const cpp = language === 'CPP' || language === 'OBJCXX';
	const sourceCpp = options.sourceLanguage === 'CPP' || options.sourceLanguage === 'OBJCXX';
	const incompatibleStandard = cpp ? /^-std=(?:(?:c|gnu)\d|iso9899:)/ : /^-std=(?:c|gnu)\+\+/;
	// Retain the active family's full command, including invalid user options.
	// Sibling profiles need their own standard when their language family differs.
	const compileArgs =
		options.sourceLanguage && cpp !== sourceCpp
			? (options.compileArgs ?? []).filter((argument) => !incompatibleStandard.test(argument))
			: (options.compileArgs ?? []);
	const omitStandardIncludes = compileArgs.includes('-nostdinc');
	const omitLibraryIncludes =
		omitStandardIncludes ||
		compileArgs.includes('-nostdlibinc') ||
		compileArgs.some(
			(argument) =>
				argument === '--sysroot' ||
				argument.startsWith('--sysroot=') ||
				argument.startsWith('-isysroot')
		);
	const includeResourceDir =
		omitStandardIncludes || compileArgs.includes('-nobuiltininc')
			? undefined
			: options.resourceDir;
	const systemIncludes = omitLibraryIncludes
		? includeResourceDir
			? [`${includeResourceDir.replace(/\/+$/, '')}/include`]
			: []
		: clangSystemIncludePaths(
				compileArgs.includes('-nostdinc++') ? 'C' : language,
				'/usr',
				includeResourceDir
			);
	return [
		profile.standardArg,
		'-x',
		profile.languageArg,
		`--target=${CLANG_WASI_DRIVER_TARGET}`,
		...(options.resourceDir ? ['-resource-dir', options.resourceDir] : []),
		...systemIncludes.map((path) => `-isystem${path}`),
		...(language === 'OBJC' || language === 'OBJCXX'
			? [
					// The execution compiler invokes cc1 directly. Pass the same runtime
					// option to the frontend: the driver rejects GNUstep 2 for Wasm.
					...OBJECTIVE_C_RUNTIME_FLAGS.flatMap((flag) =>
						flag.startsWith('-fobjc-runtime=') ? ['-Xclang', flag] : [flag]
					),
					...OBJECTIVE_C_LSP_DEFINES,
					'-I/objc',
					'-I/objc/objc'
				]
			: []),
		...compileArgs
	];
};

export const createClangdConfiguration = (
	options: ClangdCompileProfile & { resourceDir?: string } = {}
) => {
	const extensions: Record<ClangdSourceLanguage, string[]> = {
		C: ['c'],
		CPP: ['cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx'],
		OBJC: ['m'],
		OBJCXX: ['mm']
	};
	extensions[options.sourceLanguage ?? 'CPP'].push('h');
	return (['C', 'CPP', 'OBJC', 'OBJCXX'] as const)
		.map((language) =>
			JSON.stringify({
				If: {
					PathMatch: `.*\\.(${extensions[language].join('|')})`
				},
				CompileFlags: { Add: createClangdCompileFlags(language, options) }
			})
		)
		.join('\n---\n');
};
