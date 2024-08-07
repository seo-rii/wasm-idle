import type { Terminal } from '@xterm/xterm';

export default async function registerAllPlugins(term: Terminal) {
	const { FitAddon } = await import('@xterm/addon-fit');
	const { SearchAddon } = await import('@xterm/addon-search');
	const { SerializeAddon } = await import('@xterm/addon-serialize');
	const { WebLinksAddon } = await import('@xterm/addon-web-links');
	const { WebglAddon } = await import('@xterm/addon-webgl');
	const { Unicode11Addon } = await import('@xterm/addon-unicode11');

	const plugins = {
		fit: new FitAddon(),
		search: new SearchAddon(),
		serialize: new SerializeAddon(),
		weblink: new WebLinksAddon(),
		webgl: new WebglAddon(),
		unicode: new Unicode11Addon()
	};

	for (const plugin in plugins) term.loadAddon((<any>plugins)[plugin]);
	return plugins;
}
