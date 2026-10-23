/** Match the decoded, normalized POSIX paths used by the browser Java filesystem. */
export function normalizeJavaFileUri(value: string) {
	const parsed = new URL(value);
	if (
		parsed.protocol !== 'file:' ||
		parsed.host ||
		parsed.href.includes('?') ||
		parsed.href.includes('#')
	)
		throw new Error('Java source files require local file URIs without query or fragment');
	const decoded = decodeURIComponent(parsed.pathname);
	if (
		decoded.includes('\0') ||
		decoded.includes('\\') ||
		decoded.split('/').some((part) => part === '.' || part === '..')
	)
		throw new Error('Java source files require normalized local file paths');
	const segments = decoded.split('/').filter(Boolean);
	const pathname = `/${segments.join('/')}`;
	const uri = `file:///${segments.map((part) => encodeURIComponent(part)).join('/')}`;
	return { uri, pathname };
}
