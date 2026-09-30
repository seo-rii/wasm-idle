import type { Terminal } from '@xterm/xterm';

export async function registerBasicPlugins(term: Terminal, signal?: AbortSignal) {
	const [{ FitAddon }, { WebLinksAddon }, { Unicode11Addon }] = await Promise.all([
		import('@xterm/addon-fit'),
		import('@xterm/addon-web-links'),
		import('@xterm/addon-unicode11')
	]);
	signal?.throwIfAborted();

	const plugins = {
		fit: new FitAddon(),
		weblink: new WebLinksAddon(),
		unicode: new Unicode11Addon()
	};

	for (const plugin of Object.values(plugins)) term.loadAddon(plugin);
	term.unicode.activeVersion = '11';
	return plugins;
}

export async function loadSearchPlugin(term: Terminal, signal?: AbortSignal) {
	const { SearchAddon } = await import('@xterm/addon-search');
	signal?.throwIfAborted();
	const plugin = new SearchAddon();
	term.loadAddon(plugin);
	return plugin;
}

export async function loadSerializePlugin(term: Terminal, signal?: AbortSignal) {
	const { SerializeAddon } = await import('@xterm/addon-serialize');
	signal?.throwIfAborted();
	const plugin = new SerializeAddon();
	term.loadAddon(plugin);
	return plugin;
}

export async function loadWebglPlugin(term: Terminal, signal?: AbortSignal) {
	const { WebglAddon } = await import('@xterm/addon-webgl');
	signal?.throwIfAborted();
	const plugin = new WebglAddon();
	try {
		term.loadAddon(plugin);
	} catch (error) {
		plugin.dispose();
		throw error;
	}
	return plugin;
}

/** Preserve the complete plugin set for existing package consumers. */
export default async function registerAllPlugins(term: Terminal) {
	const initialization = new AbortController();
	try {
		const [basic, search, serialize, webgl] = await Promise.all([
			registerBasicPlugins(term, initialization.signal),
			loadSearchPlugin(term, initialization.signal),
			loadSerializePlugin(term, initialization.signal),
			loadWebglPlugin(term, initialization.signal)
		]);
		return { ...basic, search, serialize, webgl };
	} catch (error) {
		// Imports cannot be cancelled, but their addons must not activate after failure.
		initialization.abort();
		throw error;
	}
}
