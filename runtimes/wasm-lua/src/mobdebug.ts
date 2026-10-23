import source from './vendor/mobdebug.lua?raw';
import bootstrap from './mobdebug-bootstrap.lua?raw';

export interface LuaDebugVariable {
	name: string;
	value: string;
	type: string;
}

export interface LuaDebugFrame {
	functionName: string;
	sourcePath: string;
	line: number;
	locals: LuaDebugVariable[];
}

export type LuaDebugEvent =
	| {
			type: 'pause';
			line: number;
			sourcePath: string;
			reason: 'entry' | 'breakpoint' | 'step' | 'nextLine' | 'stepOut';
			frames: LuaDebugFrame[];
	  }
	| { type: 'evaluate'; id: number; value?: string; error?: string };

/** MobDebug's engine runs in the real Lua VM; only its socket transport is replaced. */
export interface LuaDebugOptions {
	breakpoints?: readonly number[];
	pauseOnEntry?: boolean;
	/** Return a complete protocol chunk, null when closed, or '' for a nonblocking empty read. */
	readCommand: (blocking: boolean) => string | null;
	onEvent: (event: LuaDebugEvent) => void;
}

export async function runLuaWithMobDebug(
	lua: {
		global: { set(name: string, value: unknown): void };
		doString(source: string): Promise<unknown>;
	},
	code: string,
	fileName: string,
	options: LuaDebugOptions
) {
	if (!fileName || /[\r\n\0]/u.test(fileName)) {
		throw new Error('Lua debugging requires a source filename without control characters.');
	}
	lua.global.set('__wasm_idle_mobdebug_source', source);
	lua.global.set('__wasm_idle_debug_source', code);
	lua.global.set('__wasm_idle_debug_file', fileName);
	lua.global.set('__wasm_idle_debug_entry', options.pauseOnEntry !== false);
	lua.global.set(
		'__wasm_idle_debug_breakpoints',
		(options.breakpoints ?? [])
			.filter((line) => Number.isSafeInteger(line) && line > 0)
			.slice(0, 1024)
			.join(',')
	);
	lua.global.set('__wasm_idle_debug_read', options.readCommand);
	lua.global.set('__wasm_idle_debug_event', (json: string) => {
		options.onEvent(JSON.parse(json) as LuaDebugEvent);
	});
	await lua.doString(bootstrap);
}
