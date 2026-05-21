import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sandboxInstances, createMockSandboxClass, MockSandbox } = vi.hoisted(() => {
	const sandboxInstances = new Map<string, MockSandbox[]>();

	class MockSandbox {
		language: string;
		loadCalls: any[][] = [];
		runCalls: any[][] = [];
		clearCalls = 0;
		elapse = 0;
		output?: (data: string) => void;
		ondebug?: (event: unknown) => void;
		oncompilerdiagnostic?: (diagnostic: unknown) => void;
		image?: (data: unknown) => void;

		constructor(language: string) {
			this.language = language;
			const existing = sandboxInstances.get(language) || [];
			existing.push(this);
			sandboxInstances.set(language, existing);
		}

		eof() {}

		async load(...args: any[]) {
			this.loadCalls.push(args);
		}

		async run(...args: any[]) {
			this.runCalls.push(args);
			return true;
		}

		terminate() {}

		async clear() {
			this.clearCalls += 1;
		}
	}

	const createMockSandboxClass = (language: string) =>
		class extends MockSandbox {
			constructor() {
				super(language);
			}
		};

	return { sandboxInstances, createMockSandboxClass, MockSandbox };
});

vi.mock('$lib/playground/python', () => ({
	default: createMockSandboxClass('PYTHON')
}));

vi.mock('$lib/playground/java', () => ({
	default: createMockSandboxClass('JAVA')
}));

vi.mock('$lib/playground/rust', () => ({
	default: createMockSandboxClass('RUST')
}));

vi.mock('$lib/playground/go', () => ({
	default: createMockSandboxClass('GO')
}));

vi.mock('$lib/playground/haskell', () => ({
	default: createMockSandboxClass('HASKELL')
}));

vi.mock('$lib/playground/dotnet', () => ({
	default: class extends MockSandbox {
		constructor(language: string = 'FSHARP') {
			super(language);
		}
	}
}));

vi.mock('$lib/playground/elixir', () => ({
	default: createMockSandboxClass('ELIXIR')
}));

vi.mock('$lib/playground/ocaml', () => ({
	default: createMockSandboxClass('OCAML')
}));

vi.mock('$lib/playground/tinygo', () => ({
	default: createMockSandboxClass('TINYGO')
}));

vi.mock('$lib/playground/typescript', () => ({
	default: class extends MockSandbox {
		constructor(language: string = 'TYPESCRIPT') {
			super(language);
		}
	}
}));

vi.mock('$lib/playground/zig', () => ({
	default: createMockSandboxClass('ZIG')
}));

vi.mock('$lib/playground/clang', () => ({
	default: class extends createMockSandboxClass('CLANG') {
		constructor(language: 'C' | 'CPP') {
			super();
			this.language = language;
			const entries = sandboxInstances.get(language) || [];
			entries.push(this as unknown as (typeof entries)[number]);
			sandboxInstances.set(language, entries);
		}
	}
}));

import playground, { createPlaygroundBinding } from './index';

describe('playground runtime binding', () => {
	beforeEach(() => {
		sandboxInstances.clear();
	});

	it('keeps the legacy sandbox load signature when runtime assets are not bound', async () => {
		const sandbox = await playground('PYTHON');
		const progress = { set() {} };

		await sandbox.load('/absproxy/5173', 'print(1)', false, ['-u'], { stdin: '5' }, progress);

		expect(sandboxInstances.get('PYTHON')).toHaveLength(1);
		expect(sandboxInstances.get('PYTHON')?.[0]?.loadCalls).toEqual([
			['/absproxy/5173', 'print(1)', false, ['-u'], { stdin: '5' }, progress]
		]);
	});

	it('binds runtime assets into cached playground sandboxes', async () => {
		const runtimeAssets = { rootUrl: '/repl' };
		await playground('JAVA');
		const sandbox = await playground('JAVA', runtimeAssets);
		const progress = { set() {} };

		await sandbox.load('class Main {}', false, ['one'], { stdin: '7' }, progress);

		expect(sandbox.runtimeAssets).toBe(runtimeAssets);
		expect(sandboxInstances.get('JAVA')).toHaveLength(1);
		expect(sandboxInstances.get('JAVA')?.[0]?.loadCalls.at(-1)).toEqual([
			runtimeAssets,
			'class Main {}',
			false,
			['one'],
			{ stdin: '7' },
			progress
		]);
	});

	it('creates a reusable binding for terminal props and direct playground access', async () => {
		const binding = createPlaygroundBinding('/absproxy/5173');
		const progress = { set() {} };
		const sandbox = await binding.load('RUST');

		await sandbox.load(
			'fn main() {}',
			true,
			['hello'],
			{ rustTargetTriple: 'wasm32-wasip2' },
			progress
		);

		expect(binding.terminalProps.runtimeAssets).toBe('/absproxy/5173');
		expect(binding.terminalProps.playground).toBe(binding);
		expect(sandbox.runtimeAssets).toBe('/absproxy/5173');
		expect(sandboxInstances.get('RUST')).toHaveLength(1);
		expect(sandboxInstances.get('RUST')?.[0]?.loadCalls).toEqual([
			[
				'/absproxy/5173',
				'fn main() {}',
				true,
				['hello'],
				{ rustTargetTriple: 'wasm32-wasip2' },
				progress
			]
		]);
	});

	it('routes TinyGo requests through the TinyGo sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: '/absproxy/5173/wasm-tinygo/runtime.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('TINYGO');

		await sandbox.load('package main\nfunc main() {}', true, ['demo'], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: '/absproxy/5173/wasm-tinygo/runtime.js?v=test'
			}
		});
		expect(sandboxInstances.get('TINYGO')).toHaveLength(1);
		expect(sandboxInstances.get('TINYGO')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					tinygo: {
						moduleUrl: '/absproxy/5173/wasm-tinygo/runtime.js?v=test'
					}
				},
				'package main\nfunc main() {}',
				true,
				['demo'],
				{},
				progress
			]
		]);
	});

	it('routes Go requests through the dedicated Go sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			go: {
				compilerUrl: '/absproxy/5173/wasm-go/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('GO');

		await sandbox.load('package main\nfunc main() {}', true, ['demo'], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			go: {
				compilerUrl: '/absproxy/5173/wasm-go/index.js?v=test'
			}
		});
		expect(sandboxInstances.get('GO')).toHaveLength(1);
		expect(sandboxInstances.get('GO')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					go: {
						compilerUrl: '/absproxy/5173/wasm-go/index.js?v=test'
					}
				},
				'package main\nfunc main() {}',
				true,
				['demo'],
				{},
				progress
			]
		]);
	});

	it('routes F# requests through the Dotnet sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('FSHARP');

		await sandbox.load('printfn "hello"', true, ['demo'], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		});
		expect(sandboxInstances.get('FSHARP')).toHaveLength(1);
		expect(sandboxInstances.get('FSHARP')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					dotnet: {
						moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
					}
				},
				'printfn "hello"',
				true,
				['demo'],
				{},
				progress
			]
		]);
	});

	it('routes C# requests through the Dotnet sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('CSHARP');

		await sandbox.load('Console.WriteLine("hello");', true, ['demo'], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		});
		expect(sandboxInstances.get('CSHARP')).toHaveLength(1);
		expect(sandboxInstances.get('CSHARP')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					dotnet: {
						moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
					}
				},
				'Console.WriteLine("hello");',
				true,
				['demo'],
				{},
				progress
			]
		]);
	});

	it('routes Elixir requests through the Popcorn-backed sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			elixir: {
				bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('ELIXIR');

		await sandbox.load('IO.puts("hello")', true, [], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			elixir: {
				bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
			}
		});
		expect(sandboxInstances.get('ELIXIR')).toHaveLength(1);
		expect(sandboxInstances.get('ELIXIR')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					elixir: {
						bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
					}
				},
				'IO.puts("hello")',
				true,
				[],
				{},
				progress
			]
		]);
	});

	it('routes OCaml requests through the dedicated OCaml sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			ocaml: {
				moduleUrl: '/absproxy/5173/wasm-of-js-of-ocaml/browser-native/src/index.js?v=test',
				manifestUrl:
					'/absproxy/5173/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('OCAML');

		await sandbox.load('let () = print_endline "hello"', true, [], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			ocaml: {
				moduleUrl: '/absproxy/5173/wasm-of-js-of-ocaml/browser-native/src/index.js?v=test',
				manifestUrl:
					'/absproxy/5173/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json?v=test'
			}
		});
		expect(sandboxInstances.get('OCAML')).toHaveLength(1);
		expect(sandboxInstances.get('OCAML')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					ocaml: {
						moduleUrl:
							'/absproxy/5173/wasm-of-js-of-ocaml/browser-native/src/index.js?v=test',
						manifestUrl:
							'/absproxy/5173/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json?v=test'
					}
				},
				'let () = print_endline "hello"',
				true,
				[],
				{},
				progress
			]
		]);
	});

	it('routes JavaScript and TypeScript requests through the wasm-typescript sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			typescript: {
				moduleUrl: '/absproxy/5173/wasm-typescript/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const javascriptSandbox = await binding.load('JAVASCRIPT');
		const typescriptSandbox = await binding.load('TYPESCRIPT');

		await javascriptSandbox.load('console.log(1)', true, ['demo'], {}, progress);
		await typescriptSandbox.load('const n: number = 1;', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			typescript: {
				moduleUrl: '/absproxy/5173/wasm-typescript/index.js?v=test'
			}
		};
		expect(javascriptSandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(typescriptSandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('JAVASCRIPT')).toHaveLength(1);
		expect(sandboxInstances.get('TYPESCRIPT')).toHaveLength(1);
		expect(sandboxInstances.get('JAVASCRIPT')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'console.log(1)', true, ['demo'], {}, progress]
		]);
		expect(sandboxInstances.get('TYPESCRIPT')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'const n: number = 1;', true, ['demo'], {}, progress]
		]);
	});

	it('routes Haskell requests through the bundled wasm-haskell sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			haskell: {
				moduleUrl: '/absproxy/5173/wasm-haskell/dyld.mjs?v=test',
				rootfsUrl: '/absproxy/5173/wasm-haskell/rootfs.tar.zst?v=test',
				bsdtarUrl: '/absproxy/5173/wasm-haskell/bsdtar.wasm?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('HASKELL');

		await sandbox.load('main = print 1', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			haskell: {
				moduleUrl: '/absproxy/5173/wasm-haskell/dyld.mjs?v=test',
				rootfsUrl: '/absproxy/5173/wasm-haskell/rootfs.tar.zst?v=test',
				bsdtarUrl: '/absproxy/5173/wasm-haskell/bsdtar.wasm?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('HASKELL')).toHaveLength(1);
		expect(sandboxInstances.get('HASKELL')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'main = print 1', true, ['demo'], {}, progress]
		]);
	});

	it('routes Zig requests through the bundled wasm-zig sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			zig: {
				compilerUrl: '/absproxy/5173/wasm-zig/zig_small.wasm?v=test',
				stdlibUrl: '/absproxy/5173/wasm-zig/std.zip?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('ZIG');

		await sandbox.load('pub fn main() void {}', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			zig: {
				compilerUrl: '/absproxy/5173/wasm-zig/zig_small.wasm?v=test',
				stdlibUrl: '/absproxy/5173/wasm-zig/std.zip?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('ZIG')).toHaveLength(1);
		expect(sandboxInstances.get('ZIG')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'pub fn main() void {}', true, ['demo'], {}, progress]
		]);
	});
});
