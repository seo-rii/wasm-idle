import { beforeEach, describe, expect, it, vi } from 'vitest';

const { moduleLoads, sandboxInstances, createMockSandboxClass, MockSandbox } = vi.hoisted(() => {
	const moduleLoads = new Set<string>();
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

	return { moduleLoads, sandboxInstances, createMockSandboxClass, MockSandbox };
});

vi.mock('$lib/playground/python', () => {
	moduleLoads.add('PYTHON');
	return {
		default: createMockSandboxClass('PYTHON')
	};
});

vi.mock('$lib/playground/java', () => {
	moduleLoads.add('JAVA');
	return {
		default: createMockSandboxClass('JAVA')
	};
});

vi.mock('$lib/playground/rust', () => {
	moduleLoads.add('RUST');
	return {
		default: createMockSandboxClass('RUST')
	};
});

vi.mock('$lib/playground/go', () => {
	moduleLoads.add('GO');
	return {
		default: createMockSandboxClass('GO')
	};
});

vi.mock('$lib/playground/d', () => {
	moduleLoads.add('D');
	return {
		default: createMockSandboxClass('D')
	};
});

vi.mock('$lib/playground/haskell', () => {
	moduleLoads.add('HASKELL');
	return {
		default: createMockSandboxClass('HASKELL')
	};
});

vi.mock('$lib/playground/ruby', () => {
	moduleLoads.add('RUBY');
	return {
		default: createMockSandboxClass('RUBY')
	};
});

vi.mock('$lib/playground/r', () => {
	moduleLoads.add('R');
	return {
		default: createMockSandboxClass('R')
	};
});

vi.mock('$lib/playground/octave', () => {
	moduleLoads.add('OCTAVE');
	return {
		default: createMockSandboxClass('OCTAVE')
	};
});

vi.mock('$lib/playground/prolog', () => {
	moduleLoads.add('PROLOG');
	return {
		default: createMockSandboxClass('PROLOG')
	};
});

vi.mock('$lib/playground/gleam', () => {
	moduleLoads.add('GLEAM');
	return {
		default: createMockSandboxClass('GLEAM')
	};
});

vi.mock('$lib/playground/perl', () => {
	moduleLoads.add('PERL');
	return {
		default: createMockSandboxClass('PERL')
	};
});

vi.mock('$lib/playground/tcl', () => {
	moduleLoads.add('TCL');
	return {
		default: createMockSandboxClass('TCL')
	};
});

vi.mock('$lib/playground/awk', () => {
	moduleLoads.add('AWK');
	return {
		default: createMockSandboxClass('AWK')
	};
});

vi.mock('$lib/playground/pascal', () => {
	moduleLoads.add('PASCAL');
	return {
		default: createMockSandboxClass('PASCAL')
	};
});

vi.mock('$lib/playground/sqlite', () => {
	moduleLoads.add('SQLITE');
	return {
		default: createMockSandboxClass('SQLITE')
	};
});

vi.mock('$lib/playground/php', () => {
	moduleLoads.add('PHP');
	return {
		default: createMockSandboxClass('PHP')
	};
});

vi.mock('$lib/playground/dotnet', () => {
	moduleLoads.add('DOTNET');
	return {
		default: class extends MockSandbox {
			constructor(language: string = 'FSHARP') {
				super(language);
			}
		}
	};
});

vi.mock('$lib/playground/elixir', () => {
	moduleLoads.add('ELIXIR');
	return {
		default: class extends MockSandbox {
			constructor(language: string = 'ELIXIR') {
				super(language);
			}
		}
	};
});

vi.mock('$lib/playground/ocaml', () => {
	moduleLoads.add('OCAML');
	return {
		default: createMockSandboxClass('OCAML')
	};
});

vi.mock('$lib/playground/tinygo', () => {
	moduleLoads.add('TINYGO');
	return {
		default: createMockSandboxClass('TINYGO')
	};
});

vi.mock('$lib/playground/typescript', () => {
	moduleLoads.add('TYPESCRIPT');
	return {
		default: class extends MockSandbox {
			constructor(language: string = 'TYPESCRIPT') {
				super(language);
			}
		}
	};
});

vi.mock('$lib/playground/assemblyscript', () => {
	moduleLoads.add('ASSEMBLYSCRIPT');
	return {
		default: createMockSandboxClass('ASSEMBLYSCRIPT')
	};
});

vi.mock('$lib/playground/wat', () => {
	moduleLoads.add('WAT');
	return {
		default: createMockSandboxClass('WAT')
	};
});

vi.mock('$lib/playground/lua', () => {
	moduleLoads.add('LUA');
	return {
		default: createMockSandboxClass('LUA')
	};
});

vi.mock('$lib/playground/zig', () => {
	moduleLoads.add('ZIG');
	return {
		default: createMockSandboxClass('ZIG')
	};
});

vi.mock('$lib/playground/lisp', () => {
	moduleLoads.add('LISP');
	return {
		default: createMockSandboxClass('LISP')
	};
});

vi.mock('$lib/playground/clang', () => {
	moduleLoads.add('CLANG');
	return {
		default: class extends createMockSandboxClass('CLANG') {
			constructor(language: 'C' | 'CPP') {
				super();
				this.language = language;
				const entries = sandboxInstances.get(language) || [];
				entries.push(this as unknown as (typeof entries)[number]);
				sandboxInstances.set(language, entries);
			}
		}
	};
});

import playground, { createPlaygroundBinding } from './index';

const moduleLoadsAfterFactoryImport = new Set(moduleLoads);

describe('playground runtime binding', () => {
	beforeEach(() => {
		moduleLoads.clear();
		sandboxInstances.clear();
	});

	it('does not load language sandbox modules when the playground factory is imported', () => {
		expect([...moduleLoadsAfterFactoryImport]).toEqual([]);
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

	it('routes D requests through the dedicated D sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			d: {
				moduleUrl: '/absproxy/5173/wasm-d/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('DLANG');

		await sandbox.load('void main() {}', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			d: {
				moduleUrl: '/absproxy/5173/wasm-d/index.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('D')).toHaveLength(1);
		expect(sandboxInstances.get('D')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'void main() {}', true, ['demo'], {}, progress]
		]);
		expect((await binding.load('D')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('D')).toHaveLength(1);
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

	it('routes VB.NET aliases through the Dotnet sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const code = `Imports System
Module Program
    Sub Main()
        Console.WriteLine("hello")
    End Sub
End Module`;
		const sandbox = await binding.load('VB');

		await sandbox.load(code, true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			dotnet: {
				moduleUrl: '/absproxy/5173/wasm-dotnet/index.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('VBNET')).toHaveLength(1);
		expect(sandboxInstances.get('VBNET')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, code, true, ['demo'], {}, progress]
		]);
		expect((await binding.load('VBNET')).runtimeAssets).toEqual(runtimeAssets);
		expect((await binding.load('VISUALBASIC')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('VBNET')).toHaveLength(1);
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

	it('routes Erlang aliases through the Popcorn-backed sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			erlang: {
				bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
			}
		});
		const progress = { set() {} };
		const code = 'io:format("hello~n").';
		const sandbox = await binding.load('ERLANG');

		await sandbox.load(code, true, [], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			erlang: {
				bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
			}
		});
		expect(sandboxInstances.get('ERLANG')).toHaveLength(1);
		expect(sandboxInstances.get('ERLANG')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					erlang: {
						bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
					}
				},
				code,
				true,
				[],
				{},
				progress
			]
		]);
		expect((await binding.load('ERL')).runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			erlang: {
				bundleUrl: '/absproxy/5173/wasm-elixir/bundle.avm?v=test'
			}
		});
		expect(sandboxInstances.get('ERLANG')).toHaveLength(1);
	});

	it('routes Prolog aliases through the SWI-Prolog wasm sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			prolog: {
				baseUrl: '/absproxy/5173/wasm-prolog/',
				workerUrl: '/absproxy/5173/wasm-prolog/runner-worker.js?v=test'
			}
		});
		const progress = { set() {} };
		const code = 'main :- writeln(hello).';
		const sandbox = await binding.load('SWIPL');

		await sandbox.load(code, true, [], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			prolog: {
				baseUrl: '/absproxy/5173/wasm-prolog/',
				workerUrl: '/absproxy/5173/wasm-prolog/runner-worker.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('PROLOG')).toHaveLength(1);
		expect(sandboxInstances.get('PROLOG')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, code, true, [], {}, progress]
		]);
		expect((await binding.load('PROLOG')).runtimeAssets).toEqual(runtimeAssets);
		expect((await binding.load('SWI')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('PROLOG')).toHaveLength(1);
	});

	it('routes Gleam, Perl, Tcl, AWK, and Pascal requests through their static worker wasm implementations', async () => {
		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			gleam: {
				baseUrl: '/absproxy/5173/wasm-gleam/',
				workerUrl: '/absproxy/5173/wasm-gleam/runner-worker.js?v=test',
				manifestUrl: '/absproxy/5173/wasm-gleam/source-manifest.v1.json?v=test'
			},
			perl: {
				baseUrl: '/absproxy/5173/wasm-perl/',
				workerUrl: '/absproxy/5173/wasm-perl/runner-worker.js?v=test'
			},
			tcl: {
				baseUrl: '/absproxy/5173/wasm-tcl/',
				workerUrl: '/absproxy/5173/wasm-tcl/runner-worker.js?v=test'
			},
			awk: {
				baseUrl: '/absproxy/5173/wasm-awk/',
				workerUrl: '/absproxy/5173/wasm-awk/runner-worker.js?v=test'
			},
			pascal: {
				baseUrl: '/absproxy/5173/wasm-pascal/',
				workerUrl: '/absproxy/5173/wasm-pascal/runner-worker.js?v=test'
			}
		};
		const binding = createPlaygroundBinding(runtimeAssets);
		const progress = { set() {} };
		const gleam = await binding.load('GLEAM');
		const perl = await binding.load('PERL');
		const tcl = await binding.load('TCLSH');
		const awk = await binding.load('GAWK');
		const pascal = await binding.load('PAS');

		await gleam.load('pub fn main() { Nil }', true, [], {}, progress);
		await perl.load('print "hello\\n";', true, [], {}, progress);
		await tcl.load('puts "hello"', true, [], {}, progress);
		await awk.load('{ print }', true, [], {}, progress);
		await pascal.load('program main; begin WriteLn(1); end.', true, [], {}, progress);

		expect(gleam.runtimeAssets).toEqual(runtimeAssets);
		expect(perl.runtimeAssets).toEqual(runtimeAssets);
		expect(tcl.runtimeAssets).toEqual(runtimeAssets);
		expect(awk.runtimeAssets).toEqual(runtimeAssets);
		expect(pascal.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('GLEAM')).toHaveLength(1);
		expect(sandboxInstances.get('PERL')).toHaveLength(1);
		expect(sandboxInstances.get('TCL')).toHaveLength(1);
		expect(sandboxInstances.get('AWK')).toHaveLength(1);
		expect(sandboxInstances.get('PASCAL')).toHaveLength(1);
		expect(sandboxInstances.get('GLEAM')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'pub fn main() { Nil }', true, [], {}, progress]
		]);
		expect(sandboxInstances.get('PERL')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'print "hello\\n";', true, [], {}, progress]
		]);
		expect(sandboxInstances.get('TCL')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'puts "hello"', true, [], {}, progress]
		]);
		expect(sandboxInstances.get('AWK')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, '{ print }', true, [], {}, progress]
		]);
		expect(sandboxInstances.get('PASCAL')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'program main; begin WriteLn(1); end.', true, [], {}, progress]
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

	it('routes WAT requests through the wasm-wat sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			wat: {
				moduleUrl: '/absproxy/5173/wasm-wat/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('WAT');

		await sandbox.load('(module)', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			wat: {
				moduleUrl: '/absproxy/5173/wasm-wat/index.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('WAT')).toHaveLength(1);
		expect(sandboxInstances.get('WAT')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, '(module)', true, ['demo'], {}, progress]
		]);
	});

	it('routes Lua requests through the wasm-lua sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			lua: {
				moduleUrl: '/absproxy/5173/wasm-lua/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('LUA');

		await sandbox.load('print("hello")', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			lua: {
				moduleUrl: '/absproxy/5173/wasm-lua/index.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('LUA')).toHaveLength(1);
		expect(sandboxInstances.get('LUA')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'print("hello")', true, ['demo'], {}, progress]
		]);
	});

	it('routes Lisp and Scheme aliases through the wasm-lisp sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			lisp: {
				moduleUrl: '/absproxy/5173/wasm-lisp/index.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('SCHEME');

		await sandbox.load('(display "hello")', true, ['demo'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			lisp: {
				moduleUrl: '/absproxy/5173/wasm-lisp/index.js?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('LISP')).toHaveLength(1);
		expect(sandboxInstances.get('LISP')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, '(display "hello")', true, ['demo'], {}, progress]
		]);
		expect((await binding.load('LISP')).runtimeAssets).toEqual(runtimeAssets);
		expect((await binding.load('SCM')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('LISP')).toHaveLength(1);
	});

	it('routes Haskell aliases through the wasm-haskell sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			haskell: {
				moduleUrl: '/absproxy/5173/wasm-haskell/dyld.mjs?v=test',
				rootfsUrl: '/absproxy/5173/wasm-haskell/rootfs.tar.zst?v=test',
				bsdtarUrl: '/absproxy/5173/wasm-haskell/bsdtar.wasm?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('HS');

		await sandbox.load('main = putStrLn "hello"', true, ['-Wall'], {}, progress);

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
			[runtimeAssets, 'main = putStrLn "hello"', true, ['-Wall'], {}, progress]
		]);
		expect((await binding.load('HASKELL')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('HASKELL')).toHaveLength(1);
	});

	it('routes R requests through the webR sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			r: {
				baseUrl: '/absproxy/5173/webr/test/'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('R');

		await sandbox.load('cat("hello\\n")', true, [], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			r: {
				baseUrl: '/absproxy/5173/webr/test/'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('R')).toHaveLength(1);
		expect(sandboxInstances.get('R')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'cat("hello\\n")', true, [], {}, progress]
		]);
	});

	it('routes Octave aliases through the GNU Octave wasm sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			octave: {
				baseUrl: '/absproxy/5173/wasm-octave/runtime/',
				workerUrl: '/absproxy/5173/wasm-octave/runner-worker.js?v=test',
				manifestUrl: '/absproxy/5173/wasm-octave/runtime/runtime-manifest.v1.json?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('MATLAB');

		await sandbox.load('disp("hello")', true, [], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			octave: {
				baseUrl: '/absproxy/5173/wasm-octave/runtime/',
				workerUrl: '/absproxy/5173/wasm-octave/runner-worker.js?v=test',
				manifestUrl: '/absproxy/5173/wasm-octave/runtime/runtime-manifest.v1.json?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('OCTAVE')).toHaveLength(1);
		expect(sandboxInstances.get('OCTAVE')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'disp("hello")', true, [], {}, progress]
		]);
		expect((await binding.load('OCTAVE')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('OCTAVE')).toHaveLength(1);
	});

	it('routes SQLite aliases through the SQLite sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			sqlite: {
				wasmUrl: '/absproxy/5173/sqlite/sql-wasm.wasm?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('SQL');

		await sandbox.load('select 1;', true, [], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			sqlite: {
				wasmUrl: '/absproxy/5173/sqlite/sql-wasm.wasm?v=test'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('SQLITE')).toHaveLength(1);
		expect(sandboxInstances.get('SQLITE')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, 'select 1;', true, [], {}, progress]
		]);
		expect((await binding.load('SQLITE')).runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('SQLITE')).toHaveLength(1);
	});

	it('routes PHP requests through the PHP wasm sandbox implementation', async () => {
		const binding = createPlaygroundBinding({
			rootUrl: '/absproxy/5173',
			php: {
				version: '8.5'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('PHP');

		await sandbox.load('<?php echo "hello\\n";', true, ['7'], {}, progress);

		const runtimeAssets = {
			rootUrl: '/absproxy/5173',
			php: {
				version: '8.5'
			}
		};
		expect(sandbox.runtimeAssets).toEqual(runtimeAssets);
		expect(sandboxInstances.get('PHP')).toHaveLength(1);
		expect(sandboxInstances.get('PHP')?.[0]?.loadCalls).toEqual([
			[runtimeAssets, '<?php echo "hello\\n";', true, ['7'], {}, progress]
		]);
	});
});
