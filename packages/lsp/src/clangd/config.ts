import {
	CLANG_WASI_TARGET,
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

export const createClangdCompileFlags = (
	language: ClangSourceLanguage = 'CPP',
	options: { cppVersion?: string; cVersion?: string; resourceDir?: string } = {}
) => {
	const profile = resolveClangLanguageArgs(language, options);
	return [
		profile.standardArg,
		'-x',
		profile.languageArg,
		`--target=${CLANG_WASI_TARGET}`,
		...(options.resourceDir ? ['-resource-dir', options.resourceDir] : []),
		...clangSystemIncludePaths(language, '/usr', options.resourceDir).map(
			(path) => `-isystem${path}`
		),
		...(language === 'OBJC'
			? [
					// The execution compiler invokes cc1 directly. Pass the same runtime
					// option to the frontend: the driver rejects GNUstep 2 for Wasm.
					...OBJECTIVE_C_RUNTIME_FLAGS.flatMap((flag) =>
						flag.startsWith('-fobjc-runtime=') ? ['-Xclang', flag] : [flag]
					),
					'-I/objc',
					'-I/objc/objc'
				]
			: [])
	];
};

export const createClangdConfiguration = (
	options: { cppVersion?: string; cVersion?: string; resourceDir?: string } = {}
) =>
	(['C', 'CPP', 'OBJC'] as const)
		.map((language) =>
			JSON.stringify({
				If: {
					PathMatch: {
						C: '.*\\.c',
						CPP: '.*\\.(cc|cpp|cxx|h|hh|hpp|hxx)',
						OBJC: '.*\\.m'
					}[language]
				},
				CompileFlags: { Add: createClangdCompileFlags(language, options) }
			})
		)
		.join('\n---\n');
