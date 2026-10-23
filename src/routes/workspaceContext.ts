export const WORKSPACE_STORAGE_KEY = 'wasm-idle:example-workspace:v3';

export function workspaceStorageKey(url: URL) {
	const workspaceId = url.searchParams.get('workspace');
	return workspaceId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)
		? `${WORKSPACE_STORAGE_KEY}:${workspaceId}`
		: WORKSPACE_STORAGE_KEY;
}

function createWorkspaceId() {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	// getRandomValues also works on HTTP origins where Web Locks and randomUUID are absent.
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSharedWorkspaceUrl(url: URL, workspaceId = createWorkspaceId()) {
	const editableUrl = new URL(url);
	editableUrl.hash = '';
	editableUrl.searchParams.set('workspace', workspaceId);
	return editableUrl;
}
