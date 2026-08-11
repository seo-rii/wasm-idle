import { createTinyGoRuntime, type TinyGoRuntimeOptions } from './runtime';

export * from './runtime';
export * from './upstream-entry.ts';

export const createBundledTinyGoRuntime = (
	options: Omit<TinyGoRuntimeOptions, 'assetBaseUrl'> = {}
) => {
	const runtimeEntryUrl = new URL(import.meta.url);
	runtimeEntryUrl.hash = '';
	runtimeEntryUrl.search = '';
	runtimeEntryUrl.pathname = runtimeEntryUrl.pathname.replace(/[^/]+$/, '');
	return createTinyGoRuntime({
		...options,
		assetBaseUrl: runtimeEntryUrl.toString()
	});
};
