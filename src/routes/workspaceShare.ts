// Chromium's navigation URL limit includes the scheme, origin, path and fragment.
export function isNavigableWorkspaceShare(url: string) {
	return url.length <= 2 * 1024 * 1024;
}

/** A share is copied only after the browser's clipboard write actually succeeds. */
export async function copyWorkspaceShare(
	url: string,
	clipboard: Pick<Clipboard, 'writeText'> | undefined
) {
	try {
		if (typeof clipboard?.writeText !== 'function') return false;
		await clipboard.writeText(url);
		return true;
	} catch {
		return false;
	}
}
