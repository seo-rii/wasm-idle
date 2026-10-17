import {
	createSharedWorkspaceUrl,
	WORKSPACE_STORAGE_KEY,
	workspaceStorageKey
} from './workspaceContext';
import { consumeWorkspaceQueryInput, hasWorkspaceQueryInput } from './workspaceQuery';
import { validateWorkspaceSnapshot } from './workspaceSnapshot';

export interface InitialWorkspaceOverrides {
	code: string | null;
	argsInput: string | null;
	rustTargetTriple: string | null;
	goTarget: string | null;
	ocamlBackend: string | null;
	ocamlWasmBinaryenMode: string | null;
}

export interface InitialWorkspaceSelection<Language extends string> {
	language: Language;
	source: 'share' | 'query' | 'snapshot' | 'legacy' | 'default';
	snapshot: Record<string, unknown> | null;
	storageKey: string;
	/** Replace the visible URL only after the initial state has been applied. */
	replacementUrl: URL | null;
	overrides: InitialWorkspaceOverrides;
	/** Preserve this exact input through the existing recovery flow before saving. */
	unrestoredWorkspace: string | null;
	invalidShare: boolean;
}

export interface InitialWorkspaceOptions<Language extends string> {
	url: URL;
	readStorage: (key: string) => string | null;
	normalizeLanguage: (value: string | null) => Language | null;
	languageForPath?: (path: string) => Language | null;
	fallbackLanguage: Language;
	createWorkspaceId?: () => string;
}

function decodeBase64Url(value: string | null) {
	if (value === null) return null;
	try {
		const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		return new TextDecoder().decode(
			Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
		);
	} catch {
		return null;
	}
}

/**
 * Resolve the first workspace synchronously, before any editor, shell, or runtime
 * can observe a temporary default language. This function never writes storage.
 */
export function resolveInitialWorkspace<Language extends string>(
	options: InitialWorkspaceOptions<Language>
): InitialWorkspaceSelection<Language> {
	const { url, normalizeLanguage, fallbackLanguage } = options;
	const emptyOverrides: InitialWorkspaceOverrides = {
		code: null,
		argsInput: null,
		rustTargetTriple: null,
		goTarget: null,
		ocamlBackend: null,
		ocamlWasmBinaryenMode: null
	};
	const base: InitialWorkspaceSelection<Language> = {
		language: fallbackLanguage,
		source: 'default',
		snapshot: null,
		storageKey: workspaceStorageKey(url),
		replacementUrl: null,
		overrides: emptyOverrides,
		unrestoredWorkspace: null,
		invalidShare: false
	};
	const snapshotLanguage = (snapshot: Record<string, unknown>) =>
		normalizeLanguage(typeof snapshot.language === 'string' ? snapshot.language : null) ??
		options.languageForPath?.(
			typeof snapshot.activePath === 'string' ? snapshot.activePath : ''
		) ??
		fallbackLanguage;
	const editableUrl = () =>
		consumeWorkspaceQueryInput(createSharedWorkspaceUrl(url, options.createWorkspaceId?.()));

	if (url.hash.startsWith('#workspace=')) {
		let shared: Record<string, unknown> | null = null;
		try {
			const decoded = decodeBase64Url(url.hash.slice('#workspace='.length));
			if (decoded === null) throw new Error('Invalid share encoding');
			const snapshot: unknown = JSON.parse(decoded);
			validateWorkspaceSnapshot(snapshot);
			shared = snapshot;
		} catch {
			base.invalidShare = true;
		}
		if (shared) {
			const replacementUrl = editableUrl();
			return {
				...base,
				language: snapshotLanguage(shared),
				source: 'share',
				snapshot: shared,
				storageKey: workspaceStorageKey(replacementUrl),
				replacementUrl
			};
		}
	}

	// URL imports receive their own context. Reading the base snapshot or legacy
	// code here would copy unrelated local files into a shared/imported workspace.
	if (hasWorkspaceQueryInput(url)) {
		const replacementUrl = editableUrl();
		return {
			...base,
			language: normalizeLanguage(url.searchParams.get('lang')) ?? fallbackLanguage,
			source: 'query',
			storageKey: workspaceStorageKey(replacementUrl),
			replacementUrl,
			overrides: {
				code:
					decodeBase64Url(url.searchParams.get('code64')) ?? url.searchParams.get('code'),
				argsInput:
					decodeBase64Url(url.searchParams.get('args64')) ?? url.searchParams.get('args'),
				rustTargetTriple: url.searchParams.get('rustTargetTriple'),
				goTarget: url.searchParams.get('goTarget'),
				ocamlBackend: url.searchParams.get('ocamlBackend'),
				ocamlWasmBinaryenMode: url.searchParams.get('ocamlWasmBinaryenMode')
			}
		};
	}

	const read = (key: string) => {
		try {
			return options.readStorage(key);
		} catch {
			return null;
		}
	};
	const stored = read(base.storageKey);
	if (stored !== null) {
		try {
			const snapshot: unknown = JSON.parse(stored);
			validateWorkspaceSnapshot(snapshot);
			return {
				...base,
				language: snapshotLanguage(snapshot),
				source: 'snapshot',
				snapshot
			};
		} catch {
			base.unrestoredWorkspace = stored;
		}
	}

	// Legacy global keys belong to the original local workspace only.
	if (base.storageKey !== WORKSPACE_STORAGE_KEY) return base;
	const legacyLanguage = read('language');
	const overrides: InitialWorkspaceOverrides = {
		code: read('code'),
		argsInput: read('argsInput'),
		rustTargetTriple: read('rustTargetTriple'),
		goTarget: read('goTarget'),
		ocamlBackend: read('ocamlBackend'),
		ocamlWasmBinaryenMode: read('ocamlWasmBinaryenMode')
	};
	return {
		...base,
		language: normalizeLanguage(legacyLanguage) ?? fallbackLanguage,
		source:
			legacyLanguage !== null || Object.values(overrides).some((value) => value !== null)
				? 'legacy'
				: 'default',
		overrides
	};
}
