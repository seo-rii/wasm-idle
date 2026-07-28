type ClangWorkspaceLanguage = 'C' | 'CPP' | 'OBJC';

export const normalizeWorkspacePath = (path: string) =>
	path
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');

export const normalizeDwarfWorkspacePath = (path: string) => {
	const normalized = normalizeWorkspacePath(path);
	return normalized.startsWith('workspace/') ? normalized.slice('workspace/'.length) : normalized;
};

export function resolveBuildArtifactNames(language: ClangWorkspaceLanguage, fileName?: string) {
	const normalizedFileName = normalizeWorkspacePath(fileName || '');
	const defaultStem = 'main';
	const input =
		normalizedFileName && /\.[A-Za-z0-9_-]+$/.test(normalizedFileName)
			? normalizedFileName
			: `${normalizedFileName || defaultStem}.${language === 'C' ? 'c' : language === 'OBJC' ? 'm' : 'cc'}`;
	const stem = (input.split('/').pop() || input).replace(/\.[^.]+$/, '') || defaultStem;
	return {
		input,
		obj: `${stem}.o`,
		wasm: `${stem}.wasm`
	};
}
