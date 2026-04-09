import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sandboxInstances, createMockSandboxClass } = vi.hoisted(() => {
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

	return { sandboxInstances, createMockSandboxClass };
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

vi.mock('$lib/playground/elixir', () => ({
	default: createMockSandboxClass('ELIXIR')
}));

vi.mock('$lib/playground/ocaml', () => ({
	default: createMockSandboxClass('OCAML')
}));

vi.mock('$lib/playground/tinygo', () => ({
	default: createMockSandboxClass('TINYGO')
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
				hostCompileUrl: '/absproxy/5173/api/tinygo/compile',
				moduleUrl: '/absproxy/5173/wasm-tinygo/runtime.js?v=test'
			}
		});
		const progress = { set() {} };
		const sandbox = await binding.load('TINYGO');

		await sandbox.load('package main\nfunc main() {}', true, ['demo'], {}, progress);

		expect(sandbox.runtimeAssets).toEqual({
			rootUrl: '/absproxy/5173',
			tinygo: {
				hostCompileUrl: '/absproxy/5173/api/tinygo/compile',
				moduleUrl: '/absproxy/5173/wasm-tinygo/runtime.js?v=test'
			}
		});
		expect(sandboxInstances.get('TINYGO')).toHaveLength(1);
		expect(sandboxInstances.get('TINYGO')?.[0]?.loadCalls).toEqual([
			[
				{
					rootUrl: '/absproxy/5173',
					tinygo: {
						hostCompileUrl: '/absproxy/5173/api/tinygo/compile',
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
});
