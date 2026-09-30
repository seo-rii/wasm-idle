import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let imports: string[];
let fitGate: Promise<void> | undefined;
const disposed = vi.fn();

beforeEach(() => {
	vi.resetModules();
	imports = [];
	fitGate = undefined;
	disposed.mockClear();
	for (const [name, exported] of [
		['fit', 'FitAddon'],
		['search', 'SearchAddon'],
		['serialize', 'SerializeAddon'],
		['web-links', 'WebLinksAddon'],
		['webgl', 'WebglAddon'],
		['unicode11', 'Unicode11Addon']
	]) {
		vi.doMock(`@xterm/addon-${name}`, async () => {
			imports.push(name);
			if (name === 'fit') await fitGate;
			return {
				[exported]: class {
					name = name;
					dispose() {
						disposed(name);
					}
				}
			};
		});
	}
});

function terminal() {
	return { loadAddon: vi.fn(), unicode: { activeVersion: '6' } } as unknown as Terminal;
}

describe('terminal addon loading', () => {
	it('starts the three basic imports together and never loads optional addons', async () => {
		let releaseFit!: () => void;
		fitGate = new Promise<void>((resolve) => {
			releaseFit = resolve;
		});
		const { registerBasicPlugins } = await import('../src/plugin/index.js');
		const term = terminal();
		const loading = registerBasicPlugins(term);
		await vi.waitFor(() =>
			expect([...imports].sort()).toEqual(['fit', 'unicode11', 'web-links'])
		);
		expect(term.loadAddon).not.toHaveBeenCalled();
		releaseFit();
		const plugins = await loading;
		expect(Object.keys(plugins).sort()).toEqual(['fit', 'unicode', 'weblink']);
		expect(term.loadAddon).toHaveBeenCalledTimes(3);
		expect(term.unicode.activeVersion).toBe('11');
	});

	it('loads only the requested optional feature', async () => {
		const { loadSearchPlugin, loadSerializePlugin } = await import('../src/plugin/index.js');
		const term = terminal();
		const search = await loadSearchPlugin(term);
		expect(imports).toEqual(['search']);
		expect(term.loadAddon).toHaveBeenLastCalledWith(search);
		const serialize = await loadSerializePlugin(term);
		expect(imports).toEqual(['search', 'serialize']);
		expect(term.loadAddon).toHaveBeenLastCalledWith(serialize);
	});

	it('preserves the complete addon set returned by registerAllPlugins', async () => {
		const { default: registerAllPlugins } = await import('../src/plugin/index.js');
		const term = terminal();
		const plugins = await registerAllPlugins(term);
		expect(Object.keys(plugins).sort()).toEqual([
			'fit',
			'search',
			'serialize',
			'unicode',
			'webgl',
			'weblink'
		]);
		expect(term.loadAddon).toHaveBeenCalledTimes(6);
		for (const plugin of Object.values(plugins)) {
			expect(term.loadAddon).toHaveBeenCalledWith(plugin);
		}
	});

	it('does not activate addons if the terminal is disposed while an import is pending', async () => {
		let releaseFit!: () => void;
		fitGate = new Promise<void>((resolve) => {
			releaseFit = resolve;
		});
		const { registerBasicPlugins, loadWebglPlugin } = await import('../src/plugin/index.js');
		const term = terminal();
		const controller = new AbortController();
		const loading = registerBasicPlugins(term, controller.signal);
		await vi.waitFor(() => expect(imports).toContain('fit'));
		controller.abort();
		releaseFit();
		await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
		await expect(loadWebglPlugin(term, controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(term.loadAddon).not.toHaveBeenCalled();
	});

	it('disposes an optional WebGL addon that cannot acquire a GPU context', async () => {
		const { loadWebglPlugin } = await import('../src/plugin/index.js');
		const term = terminal();
		vi.mocked(term.loadAddon).mockImplementation(() => {
			throw new Error('No WebGL context');
		});
		await expect(loadWebglPlugin(term)).rejects.toThrow('No WebGL context');
		expect(disposed).toHaveBeenCalledWith('webgl');
	});
});
