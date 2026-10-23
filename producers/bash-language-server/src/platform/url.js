export * from 'url/';
import path from 'path-browserify';
export { URL, URLSearchParams } from './web-url.js';

export function fileURLToPath(value) {
	const url = value instanceof URL ? value : new URL(value);
	if (url.protocol !== 'file:') throw new Error('Expected a file URL');
	return decodeURIComponent(url.pathname);
}

export function pathToFileURL(value) {
	return new URL(`file://${path.resolve(value).split('/').map(encodeURIComponent).join('/')}`);
}
