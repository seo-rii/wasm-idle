export const WORKSPACE_STORAGE_KEY = 'wasm-idle:example-workspace:v3';

export function workspaceStorageKey(url: URL) {
	const workspaceId = url.searchParams.get('workspace');
	return workspaceId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)
		? `${WORKSPACE_STORAGE_KEY}:${workspaceId}`
		: WORKSPACE_STORAGE_KEY;
}

export function createSharedWorkspaceUrl(url: URL, workspaceId = crypto.randomUUID()) {
	const editableUrl = new URL(url);
	editableUrl.hash = '';
	editableUrl.searchParams.set('workspace', workspaceId);
	return editableUrl;
}
