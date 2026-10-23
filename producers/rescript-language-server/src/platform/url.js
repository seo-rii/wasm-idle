export * from 'url/';
export const fileURLToPath = (value) => {
	const url = new URL(value);
	if (url.protocol !== 'file:' || url.hostname) throw new TypeError('Expected a local file URI');
	return decodeURIComponent(url.pathname);
};
export const pathToFileURL = (value) =>
	new URL('file://' + value.split('/').map(encodeURIComponent).join('/'));
