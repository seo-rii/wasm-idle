import type { PlaygroundLanguage } from './language-registry';
import { parseArgs } from './parseArgs';

export const cVersions = ['C89', 'C99', 'C11', 'C17', 'C23', 'C2Y'] as const;
export type CVersion = (typeof cVersions)[number];
export const optimizationLevels = ['default', '0', '1', '2', '3', 's', 'z'] as const;
export const warningLevels = ['default', 'all', 'extra', 'none'] as const;

export interface CompilerSettings {
	arguments: string;
	cVersion: CVersion;
	optimization: (typeof optimizationLevels)[number];
	warnings: (typeof warningLevels)[number];
	warningsAsErrors: boolean;
	pedantic: boolean;
	gnuExtensions: boolean;
}

export type CompilerOptionsByLanguage = Partial<Record<PlaygroundLanguage, CompilerSettings>>;

export const defaultCompilerSettings: Readonly<CompilerSettings> = Object.freeze({
	arguments: '',
	cVersion: 'C11',
	optimization: 'default',
	warnings: 'default',
	warningsAsErrors: false,
	pedantic: false,
	gnuExtensions: true
});

export const clangCompilerLanguages = new Set<PlaygroundLanguage>([
	'C',
	'CPP',
	'OBJC',
	'OBJECTIVECXX'
]);

/** Match the driver's C++ filename inference and the Objective-C worker's per-file frontend. */
export function resolveCompilerSourceLanguage(
	language: PlaygroundLanguage,
	activePath: string
): PlaygroundLanguage {
	if (language === 'C' && /\.(?:cc|cpp|cxx|C)$/u.test(activePath)) return 'CPP';
	if (language !== 'OBJC' && language !== 'OBJECTIVECXX') return language;
	if (/\.mm$/iu.test(activePath)) return 'OBJECTIVECXX';
	if (/\.(?:m|c)$/iu.test(activePath)) return 'OBJC';
	return language;
}

export const compilerArgumentConfig: Partial<
	Record<PlaygroundLanguage, { label: string; placeholder: string; help: string }>
> = {
	C: {
		label: 'Compiler arguments',
		placeholder: '-DVALUE=42 -Iinclude',
		help: 'Additional Clang flags follow the selected options and can override them.'
	},
	CPP: {
		label: 'Compiler arguments',
		placeholder: '-DVALUE=42 -Iinclude',
		help: 'Additional Clang flags follow the selected options and can override them.'
	},
	OBJC: {
		label: 'Compiler arguments',
		placeholder: '-DVALUE=42 -Iinclude',
		help: 'Additional Objective-C Clang flags.'
	},
	OBJECTIVECXX: {
		label: 'Compiler arguments',
		placeholder: '-DVALUE=42 -Iinclude',
		help: 'Additional Objective-C++ Clang flags.'
	},
	D: {
		label: 'Compiler arguments',
		placeholder: '-O2 -w -d-version=Example',
		help: 'Additional LDC compiler flags. LLDB builds retain their required debug profile.'
	},
	ZIG: {
		label: 'Compiler arguments',
		placeholder: '-O ReleaseFast',
		help: 'Additional Zig build-exe flags. An explicit -O selection overrides ReleaseSmall.'
	},
	V: {
		label: 'Compiler arguments',
		placeholder: '-prod -d example',
		help: 'Flags passed to the V frontend before compilation to C.'
	},
	COBOL: {
		label: 'Compiler arguments',
		placeholder: '-Wall -std=cobol2014 -fixed',
		help: 'GnuCOBOL frontend flags, including dialect and source format.'
	},
	FORTRAN: {
		label: 'C backend arguments',
		placeholder: '-O2 -w',
		help: 'Flags for Clang compiling the generated C. These are not f2c or LFortran options.'
	},
	HASKELL: {
		label: 'GHC arguments',
		placeholder: '-O2 -Wall -XGHC2021',
		help: 'GHC compiler flags. This runtime does not support separate program arguments.'
	}
};

/** Keep individual argv tokens intact; no shell expansion is performed. */
export function resolveCompilerArguments(
	language: PlaygroundLanguage,
	settings: CompilerSettings,
	cppVersion = 'CPP20',
	activePath = ''
) {
	language = resolveCompilerSourceLanguage(language, activePath);
	const extra = parseArgs(settings.arguments);
	if (language === 'HASKELL' && extra.some((argument) => !argument || /\s/u.test(argument))) {
		throw new Error(
			'This GHC runtime cannot accept empty arguments or arguments containing spaces.'
		);
	}
	if (!clangCompilerLanguages.has(language)) return extra;
	const standard =
		language === 'CPP' || language === 'OBJECTIVECXX'
			? cppVersion.replace(/^CPP/, 'c++').toLowerCase()
			: settings.cVersion.toLowerCase();
	return [
		...(!settings.gnuExtensions && (language === 'C' || language === 'CPP')
			? [`-std=${standard}`]
			: []),
		...(settings.optimization === 'default' ? [] : [`-O${settings.optimization}`]),
		...(settings.warnings === 'all'
			? ['-Wall']
			: settings.warnings === 'extra'
				? ['-Wall', '-Wextra']
				: settings.warnings === 'none'
					? ['-w']
					: []),
		...(settings.warningsAsErrors ? ['-Werror'] : []),
		...(settings.pedantic ? ['-pedantic'] : []),
		...extra
	];
}

/** clangd retains the active command and filters opposite-family standards for sibling files. */
export function resolveClangdCompilerArguments(
	language: PlaygroundLanguage,
	settings: CompilerSettings,
	cppVersion: string,
	activePath: string
) {
	const args = resolveCompilerArguments(language, settings, cppVersion, activePath);
	if (language !== 'OBJC' && language !== 'OBJECTIVECXX') return args;
	const prefix = settings.gnuExtensions ? 'gnu' : 'c';
	const standards = [
		`-std=${prefix}${settings.cVersion.slice(1).toLowerCase()}`,
		`-std=${prefix}++${cppVersion.replace(/^CPP/, '').toLowerCase()}`
	];
	if (resolveCompilerSourceLanguage(language, activePath) !== 'OBJECTIVECXX') standards.reverse();
	return [...standards, ...args];
}

/** Validate saved/shared JSON before replacing any workspace state. */
export function readCompilerOptions(value: unknown): CompilerOptionsByLanguage {
	if (value === undefined) return {};
	const invalid = (field: string): never => {
		throw new Error(`Invalid workspace snapshot: compilerOptions.${field}`);
	};
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('root');
	const result: CompilerOptionsByLanguage = {};
	const choices: Record<string, readonly string[]> = {
		cVersion: cVersions,
		optimization: optimizationLevels,
		warnings: warningLevels
	};
	for (const [language, entry] of Object.entries(value as Record<string, unknown>)) {
		if (!Object.hasOwn(compilerArgumentConfig, language)) invalid(language);
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid(language);
		const settings = entry as Record<string, unknown>;
		for (const [field, setting] of Object.entries(settings)) {
			if (!Object.hasOwn(defaultCompilerSettings, field)) invalid(`${language}.${field}`);
			const valid =
				field === 'arguments'
					? typeof setting === 'string'
					: Object.hasOwn(choices, field)
						? typeof setting === 'string' && choices[field].includes(setting)
						: typeof setting === 'boolean';
			if (!valid) invalid(`${language}.${field}`);
		}
		result[language as PlaygroundLanguage] = { ...defaultCompilerSettings, ...settings };
	}
	return result;
}

/** Legacy C-family and Haskell Args fields contained compiler flags. */
export function restoreCompilerOptions(
	value: unknown,
	language: PlaygroundLanguage,
	argsInput: string
) {
	const compilerOptions = readCompilerOptions(value);
	if (value === undefined && (clangCompilerLanguages.has(language) || language === 'HASKELL')) {
		compilerOptions[language] = { ...defaultCompilerSettings, arguments: argsInput };
		return { compilerOptions, argsInput: '' };
	}
	return { compilerOptions, argsInput };
}
