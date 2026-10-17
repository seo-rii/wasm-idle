import { describe, expect, it, vi } from 'vitest';
import { resolveInitialWorkspace } from './initialWorkspace';
import { WORKSPACE_STORAGE_KEY } from './workspaceContext';

const workspaceId = 'c64d824e-179b-49fe-955c-707c99477db4';
const previousWorkspaceId = '443d6657-603f-4a8d-9885-d20f97b2d7ac';
type Language = 'CPP' | 'C' | 'PYTHON' | 'RUST' | 'GO';
function normalizeLanguage(value: string | null): Language | null {
	const normalized = value?.trim().toUpperCase();
	if (normalized === 'C++') return 'CPP';
	return ['CPP', 'C', 'PYTHON', 'RUST', 'GO'].includes(normalized ?? '')
		? (normalized as Language)
		: null;
}
function snapshot(language = 'CPP') {
	const path = language === 'PYTHON' ? 'main.py' : 'main.cpp';
	return { version: 6, language, activePath: path, files: [{ path, content: 'local source' }] };
}
function initial(href: string, values: Record<string, string> = {}) {
	const readStorage = vi.fn((key: string) => values[key] ?? null);
	const selection = resolveInitialWorkspace({
		url: new URL(href, 'https://example.test/wasm-idle/'),
		readStorage,
		normalizeLanguage,
		languageForPath: (path) => (path.endsWith('.py') ? 'PYTHON' : null),
		fallbackLanguage: 'CPP' as Language,
		createWorkspaceId: () => workspaceId
	});
	return { selection, readStorage };
}
function encoded(value: string) {
	return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

describe('initial workspace selection before the editor and container mount', () => {
	it('uses an explicit URL language before a previously saved C++ workspace', () => {
		const { selection, readStorage } = initial('?lang=python', {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(snapshot()),
			language: 'CPP',
			code: 'private local source'
		});
		expect(selection).toMatchObject({ language: 'PYTHON', source: 'query', snapshot: null });
		expect(selection.storageKey).toBe(`${WORKSPACE_STORAGE_KEY}:${workspaceId}`);
		expect(selection.overrides.code).toBeNull();
		expect(readStorage).not.toHaveBeenCalled();
		expect(selection.replacementUrl?.searchParams.get('lang')).toBeNull();
	});

	it('restores saved Python synchronously instead of briefly selecting the default compiler', () => {
		const saved = snapshot('PYTHON');
		const { selection, readStorage } = initial('', {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(saved),
			language: 'CPP'
		});
		expect(selection).toMatchObject({
			language: 'PYTHON',
			source: 'snapshot',
			snapshot: saved
		});
		expect(readStorage).toHaveBeenCalledExactlyOnceWith(WORKSPACE_STORAGE_KEY);
		expect(selection.replacementUrl).toBeNull();
	});

	it('gives a valid shared hash priority over URL language and all local preferences', () => {
		const shared = snapshot('PYTHON');
		const url = new URL(
			`https://example.test/wasm-idle/?lang=cpp&code=other#workspace=${encoded(JSON.stringify(shared))}`
		);
		const { selection, readStorage } = initial(url.href, {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(snapshot()),
			code: 'secret'
		});
		expect(selection).toMatchObject({ language: 'PYTHON', source: 'share', snapshot: shared });
		expect(selection.replacementUrl?.hash).toBe('');
		expect(selection.replacementUrl?.searchParams.get('code')).toBeNull();
		expect(selection.storageKey).toBe(`${WORKSPACE_STORAGE_KEY}:${workspaceId}`);
		expect(readStorage).not.toHaveBeenCalled();
		expect(url.searchParams.get('lang')).toBe('cpp');
		expect(url.hash).toContain('#workspace=');
	});

	it('decodes Unicode and empty code/args inputs without importing local data', () => {
		const code = 'print("한글 🦀")';
		const { selection } = initial(
			`?lang=python&code64=${encoded(code)}&args64=${encoded('α β')}`,
			{
				code: 'private',
				argsInput: 'private args'
			}
		);
		expect(selection.overrides).toMatchObject({ code, argsInput: 'α β' });
		expect(
			initial('?lang=c&code=&args=', { code: 'private' }).selection.overrides
		).toMatchObject({ code: '', argsInput: '' });
	});

	it('retains existing query settings and consumes only workspace import parameters', () => {
		const { selection } = initial(
			'?lang=rust&rustTargetTriple=wasm32-wasip2&goTarget=js/wasm&ocamlBackend=js&ocamlWasmBinaryenMode=full&theme=dark'
		);
		expect(selection.overrides).toMatchObject({
			rustTargetTriple: 'wasm32-wasip2',
			goTarget: 'js/wasm',
			ocamlBackend: 'js',
			ocamlWasmBinaryenMode: 'full'
		});
		expect(selection.replacementUrl?.searchParams.get('theme')).toBe('dark');
		expect(selection.replacementUrl?.searchParams.get('workspace')).toBe(workspaceId);
	});

	it('restores only the explicitly selected editable URL workspace', () => {
		const key = `${WORKSPACE_STORAGE_KEY}:${previousWorkspaceId}`;
		const { selection, readStorage } = initial(`?workspace=${previousWorkspaceId}`, {
			[key]: JSON.stringify(snapshot('PYTHON')),
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(snapshot()),
			code: 'private'
		});
		expect(selection).toMatchObject({
			language: 'PYTHON',
			source: 'snapshot',
			storageKey: key
		});
		expect(readStorage).toHaveBeenCalledExactlyOnceWith(key);
	});

	it('keeps a new URL workspace isolated when it has no saved snapshot', () => {
		const { selection, readStorage } = initial(`?workspace=${previousWorkspaceId}`, {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(snapshot('PYTHON')),
			language: 'PYTHON',
			code: 'private',
			argsInput: 'private args'
		});
		expect(selection).toMatchObject({ language: 'CPP', source: 'default', snapshot: null });
		expect(selection.overrides.code).toBeNull();
		expect(readStorage).toHaveBeenCalledExactlyOnceWith(
			`${WORKSPACE_STORAGE_KEY}:${previousWorkspaceId}`
		);
	});

	it('keeps malformed stored bytes available for recovery without writing or deleting them', () => {
		const raw = '{"language":"PYTHON","files":';
		const values = {
			[WORKSPACE_STORAGE_KEY]: raw,
			language: 'PYTHON',
			code: 'recoverable legacy'
		};
		const before = { ...values };
		const { selection } = initial('', values);
		expect(selection).toMatchObject({
			language: 'PYTHON',
			source: 'legacy',
			unrestoredWorkspace: raw,
			overrides: { code: 'recoverable legacy' }
		});
		expect(values).toEqual(before);
	});

	it('validates full snapshots before trusting their language field', () => {
		const raw = JSON.stringify({
			language: 'PYTHON',
			files: [{ path: '../escape.py', content: 'bad' }]
		});
		const { selection } = initial('', { [WORKSPACE_STORAGE_KEY]: raw });
		expect(selection).toMatchObject({
			language: 'CPP',
			snapshot: null,
			unrestoredWorkspace: raw
		});
	});

	it('reports an invalid shared hash while retaining the selected local snapshot', () => {
		const { selection } = initial('#workspace=not%base64', {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify(snapshot('PYTHON'))
		});
		expect(selection).toMatchObject({
			language: 'PYTHON',
			source: 'snapshot',
			invalidShare: true
		});
	});

	it('uses legacy language only in the original context and falls back only without preferences', () => {
		expect(initial('', { language: 'python', code: 'print(1)' }).selection).toMatchObject({
			language: 'PYTHON',
			source: 'legacy',
			overrides: { code: 'print(1)' }
		});
		expect(initial('').selection).toMatchObject({ language: 'CPP', source: 'default' });
		expect(initial('', { language: 'removed-language' }).selection.language).toBe('CPP');
	});

	it('can infer a legacy snapshot language from its active source path', () => {
		const { selection } = initial('', {
			[WORKSPACE_STORAGE_KEY]: JSON.stringify({
				files: [{ path: 'main.py', content: 'print(1)' }],
				activePath: 'main.py'
			})
		});
		expect(selection.language).toBe('PYTHON');
	});

	it('still initializes when browser storage access is unavailable', () => {
		expect(
			resolveInitialWorkspace({
				url: new URL('https://example.test/wasm-idle/'),
				readStorage() {
					throw new Error('Storage denied');
				},
				normalizeLanguage,
				fallbackLanguage: 'CPP'
			})
		).toMatchObject({ language: 'CPP', source: 'default', unrestoredWorkspace: null });
	});

	it('never substitutes private local state when creating the shared workspace fails', () => {
		const readStorage = vi.fn(() => JSON.stringify(snapshot()));
		expect(() =>
			resolveInitialWorkspace({
				url: new URL(
					`https://example.test/wasm-idle/#workspace=${encoded(JSON.stringify(snapshot('PYTHON')))}`
				),
				readStorage,
				normalizeLanguage,
				fallbackLanguage: 'CPP',
				createWorkspaceId() {
					throw new Error('Workspace identity unavailable');
				}
			})
		).toThrow('Workspace identity unavailable');
		expect(readStorage).not.toHaveBeenCalled();
	});
});
