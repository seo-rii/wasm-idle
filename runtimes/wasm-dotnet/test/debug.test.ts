import { beforeEach, expect, it, vi } from 'vitest';
import { compileDotnet } from '../src/compiler.js';
import { connectMonoDebugAgent } from '../src/debug-agent.js';
import {
	loadDotnetCompilerRuntime,
	resetDotnetCompilerRuntimeForTests
} from '../src/runtime-loader.js';

beforeEach(() => resetDotnetCompilerRuntimeForTests());

it('forwards a source path and preserves the actual compiler debug artifact', async () => {
	const debug = {
		format: 'portable-pdb' as const,
		sourcePath: '/workspace/nested/Main.cs',
		assemblyName: 'test',
		moduleVersionId: 'mvid',
		assemblyBytesBase64: 'TVo=',
		symbolsBytesBase64: 'QlNKQg=='
	};
	const compile = vi.fn(async () => ({ success: true, assemblyId: 'assembly', debug }));
	const result = await compileDotnet(
		{ code: 'class Main {}', language: 'csharp', debug: true, sourcePath: debug.sourcePath },
		{
			loadRuntime: async () => ({ compile, run: async () => ({ exitCode: 0 }) })
		}
	);
	expect(compile).toHaveBeenCalledWith(
		expect.objectContaining({ debug: true, sourcePath: debug.sourcePath })
	);
	expect(result.artifact?.debug).toBe(debug);
});

it('rejects an old runtime that silently ignores a Portable PDB request', async () => {
	const result = await compileDotnet(
		{ code: 'class Main {}', language: 'csharp', debug: true },
		{
			loadRuntime: async () => ({
				compile: async () => ({ success: true, assemblyId: 'assembly' }),
				run: async () => ({ exitCode: 0 })
			})
		}
	);
	expect(result.success).toBe(false);
	expect(result.artifact).toBeUndefined();
	expect(result.stderr).toContain('did not return Portable PDB');
});

it.each(['/tmp/Main.cs', '/workspace/../Main.cs', '/workspace/a\\Main.cs', '/workspace//Main.cs'])(
	'rejects invalid source document path %s before starting the compiler',
	async (sourcePath) => {
		const loadRuntime = vi.fn();
		expect(
			(
				await compileDotnet(
					{ code: 'class Main {}', language: 'csharp', debug: true, sourcePath },
					{ loadRuntime }
				)
			).success
		).toBe(false);
		expect(loadRuntime).not.toHaveBeenCalled();
	}
);

function nativeRuntime() {
	return {
		INTERNAL: {
			mono_wasm_runtime_is_ready: true,
			mono_wasm_send_dbg_command: vi.fn((id: number) => ({ id, value: 'AQAAAA==' })),
			mono_wasm_debugger_attached: vi.fn(),
			mono_wasm_detach_debugger: vi.fn()
		},
		getAssemblyExports: async () => ({ CompilerHost: { Compile: () => '{}', Run: () => '{}' } })
	};
}

it('requires a real VM.Version response, then delegates commands and attach state to Mono', () => {
	const runtime = nativeRuntime();
	const agent = connectMonoDebugAgent(runtime);
	expect(runtime.INTERNAL.mono_wasm_send_dbg_command).toHaveBeenCalledWith(1, 1, 1, '');
	agent.sendCommand(11, 1, 'AAAAAA==');
	expect(runtime.INTERNAL.mono_wasm_send_dbg_command).toHaveBeenLastCalledWith(
		2,
		11,
		1,
		'AAAAAA=='
	);
	agent.attach();
	agent.detach();
	expect(runtime.INTERNAL.mono_wasm_debugger_attached).toHaveBeenCalledOnce();
	expect(runtime.INTERNAL.mono_wasm_detach_debugger).toHaveBeenCalledOnce();
	expect(() => agent.sendCommand(256, 1)).toThrow('byte-sized');
	expect(() => agent.sendCommand(1, 1, '!')).toThrow('base64');
});

it('does not infer a native debugger from JS wrapper presence', () => {
	const runtime = nativeRuntime();
	runtime.INTERNAL.mono_wasm_send_dbg_command.mockImplementation(() => {
		throw new Error('native debugger was not linked');
	});
	expect(() => connectMonoDebugAgent(runtime)).toThrow('native debugger was not linked');
	expect(() => connectMonoDebugAgent({ INTERNAL: {} })).toThrow('ready Mono debugger');
});

it('isolates debug cache entries and enables the agent after the boot manifest loads', async () => {
	const levels: number[] = [];
	const bootLevels: number[] = [];
	let onConfigLoaded: ((config: { debugLevel?: number }) => void) | undefined;
	const runtime = nativeRuntime();
	const builder = {
		withModuleConfig(config: { onConfigLoaded?: typeof onConfigLoaded }) {
			onConfigLoaded = config.onConfigLoaded;
			return this;
		},
		withDebugging(level: number) {
			levels.push(level);
			return this;
		},
		create: vi.fn(async () => {
			const config = { debugLevel: 0 };
			onConfigLoaded?.(config);
			bootLevels.push(config.debugLevel);
			return runtime;
		})
	};
	const options = { language: 'csharp' as const, dotnetModule: { dotnet: builder } };
	const normal = await loadDotnetCompilerRuntime(options);
	const debug = await loadDotnetCompilerRuntime({ ...options, enableDebugging: true });
	expect(debug).not.toBe(normal);
	expect(normal.debugAgent).toBeUndefined();
	expect(debug.debugAgent?.versionReply.value).toBe('AQAAAA==');
	expect(levels).toEqual([1]);
	expect(bootLevels).toEqual([0, 1]);
	expect(builder.create).toHaveBeenCalledTimes(2);
});
