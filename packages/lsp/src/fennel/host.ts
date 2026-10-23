import { fetchBoundedExternalAsset } from '../external-asset.js';
import { FENNEL_LSP_PROFILE } from './profile.js';

interface LuaEngine {
	global: { set(name: string, value: unknown): void; get(name: string): unknown; close(): void };
	doString(source: string): Promise<unknown>;
}

interface LuaRuntime {
	LuaFactory: new (wasmUrl: string) => { createEngine(): Promise<LuaEngine> };
}

export interface FennelServerOptions {
	baseUrl: string;
}

export interface FennelServer {
	handle(message: unknown): unknown[];
	dispose(): void;
}

export async function createFennelServer(options: FennelServerOptions): Promise<FennelServer> {
	const root = new URL(options.baseUrl);
	if (!root.pathname.endsWith('/')) throw new Error('Fennel LSP baseUrl must end with /');
	if (
		!['https:', 'http:'].includes(root.protocol) ||
		root.username ||
		root.password ||
		root.hash ||
		root.search
	) {
		throw new Error('Fennel LSP requires a plain HTTP(S) asset root');
	}
	const load = (name: 'engine.mjs' | 'lua.wasm' | 'fennel-ls.lua') =>
		fetchBoundedExternalAsset({
			url: new URL(name, root),
			label: `Fennel LSP ${name}`,
			integrity: FENNEL_LSP_PROFILE.assets[name],
			maxBytes: 4 * 1024 * 1024,
			runtimeId: 'fennel-lsp'
		});
	const [engineBytes, wasmBytes, serverBytes] = await Promise.all([
		load('engine.mjs'),
		load('lua.wasm'),
		load('fennel-ls.lua')
	]);
	const decode = new TextDecoder('utf-8', { fatal: true });
	const engineUrl = URL.createObjectURL(
		new Blob([decode.decode(engineBytes)], { type: 'text/javascript' })
	);
	const wasmUrl = URL.createObjectURL(
		new Blob([Uint8Array.from(wasmBytes).buffer], { type: 'application/wasm' })
	);
	let lua: LuaEngine | undefined;
	try {
		const runtime = (await import(/* @vite-ignore */ engineUrl)) as LuaRuntime;
		lua = await new runtime.LuaFactory(wasmUrl).createEngine();
		lua.global.set('__wasm_idle_fennel_bundle', decode.decode(serverBytes));
		await lua.doString(`
local cli = assert(load(__wasm_idle_fennel_bundle, '@fennel-ls.lua'))()
__wasm_idle_fennel_bundle = nil
local json = require('dkjson')
local server = {}
function __wasm_idle_fennel_handle(text)
  local message, _, err = json.decode(text)
  assert(message, err)
  return json.encode(cli['handle-one-message'](server, message))
end
`);
		const handle = lua.global.get('__wasm_idle_fennel_handle');
		if (typeof handle !== 'function')
			throw new Error('The original Fennel LSP did not initialize');
		const activeLua = lua;
		let disposed = false;
		return {
			handle(message) {
				if (disposed) throw new Error('Fennel LSP has been disposed');
				const messages = JSON.parse(String(handle(JSON.stringify(message)))) as unknown;
				if (!Array.isArray(messages)) throw new Error('Invalid upstream Fennel LSP output');
				return messages;
			},
			dispose() {
				if (disposed) return;
				disposed = true;
				activeLua.global.close();
			}
		};
	} catch (error) {
		lua?.global.close();
		throw error;
	} finally {
		URL.revokeObjectURL(engineUrl);
		URL.revokeObjectURL(wasmUrl);
	}
}
