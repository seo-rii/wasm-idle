import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	verifyRubyRuntimePreflightPayload: vi.fn(),
	rewriteVerifiedRubyRuntimeModule: vi.fn(),
	importRuntimeModule: vi.fn()
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	verifyRubyRuntimePreflightPayload: mocks.verifyRubyRuntimePreflightPayload,
	rewriteVerifiedRubyRuntimeModule: mocks.rewriteVerifiedRubyRuntimeModule
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: mocks.importRuntimeModule
}));

const payload = Object.freeze({
	protocol: 'wasm-idle-ruby-preflight',
	protocolVersion: 1,
	profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4',
	artifactRevision: '3'.repeat(40),
	rubyVersion: '3.4.1',
	rubyRevision: '4'.repeat(40),
	rubyWasmVersion: '2.9.3-2.9.4',
	rubyWasmRevision: '3'.repeat(40),
	wasiSdkVersion: '22.0',
	manifestFingerprint: '5'.repeat(64),
	manifestBytes: new Uint8Array([1]),
	moduleJavaScriptBytes: new Uint8Array([2]),
	wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
});
const moduleSource = 'export const verified = true;';
const rubyEvalMock = vi.fn();
const rubyInstantiateMock = vi.fn(async () => ({ vm: { eval: rubyEvalMock } }));
class RubyFd {}
class RubyFile {
	constructor(
		readonly data: Uint8Array,
		readonly options?: { readonly?: boolean }
	) {}
}
class RubyDirectory {
	constructor(readonly contents: Map<string, unknown>) {}
}
class RubyOpenFile {
	constructor(readonly file: RubyFile) {}
}
class RubyPreopenDirectory {
	constructor(
		readonly path: string,
		readonly contents: Map<string, unknown>
	) {}
}
class RubyWasi {
	constructor(
		readonly args: string[],
		readonly env: string[],
		readonly fds: unknown[]
	) {}
}
const runtimeModule = {
	RubyVM: { instantiateModule: rubyInstantiateMock },
	consolePrinter: vi.fn(() => ({
		addToImports: vi.fn(),
		setMemory: vi.fn()
	})),
	rubyStdlibWasmUrl: 'wasm-idle-verified:ruby/assets/ruby-stdlib.wasm',
	wasiShim: {
		Directory: RubyDirectory,
		Fd: RubyFd,
		File: RubyFile,
		Inode: { issue_ino: vi.fn(() => 1n) },
		OpenFile: RubyOpenFile,
		PreopenDirectory: RubyPreopenDirectory,
		WASI: RubyWasi,
		wasi: {
			ERRNO_SUCCESS: 0,
			FILETYPE_CHARACTER_DEVICE: 2,
			RIGHTS_FD_READ: 2,
			Fdstat: class {
				fs_rights_base = 0n;
				constructor(
					readonly filetype: number,
					readonly flags: number
				) {}
			},
			Filestat: class {
				constructor(
					readonly ino: bigint,
					readonly filetype: number,
					readonly size: bigint
				) {}
			}
		}
	}
};

const loadWorker = async () => {
	await import('./ruby');
	return (globalThis as any).self.onmessage as (event: { data: any }) => Promise<void>;
};

describe('Ruby untouched VM preparation', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		mocks.verifyRubyRuntimePreflightPayload.mockReset();
		mocks.rewriteVerifiedRubyRuntimeModule.mockReset();
		mocks.importRuntimeModule.mockReset();
		rubyEvalMock.mockReset();
		rubyInstantiateMock.mockReset();
		rubyInstantiateMock.mockImplementation(async () => ({
			vm: { eval: rubyEvalMock }
		}));
		runtimeModule.consolePrinter.mockReset().mockImplementation(() => ({
			addToImports: vi.fn(),
			setMemory: vi.fn()
		}));
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(() => {
			throw new Error('Ruby execution worker must not fetch runtime assets');
		});
		mocks.verifyRubyRuntimePreflightPayload.mockResolvedValue(payload);
		mocks.rewriteVerifiedRubyRuntimeModule.mockReturnValue(moduleSource);
		mocks.importRuntimeModule.mockResolvedValue(runtimeModule);
	});

	const load = { load: true, runtimePreflight: payload, maxAssetBytes: 1024 };
	const request = (extra: Record<string, unknown> = {}) => ({
		buffer: new SharedArrayBuffer(1024),
		code: 'puts 42',
		stdin: '',
		log: false,
		activePath: 'main.rb',
		workspaceFiles: [],
		args: [],
		...extra
	});
	async function ready() {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const handle = await loadWorker();
		await handle({ data: load });
		return handle;
	}

	it('prepares one default interpreter before ready without evaluating user source or reading input', async () => {
		await ready();
		expect(rubyInstantiateMock).toHaveBeenCalledOnce();
		expect(rubyEvalMock).not.toHaveBeenCalled();
		expect(postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect(postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ output: expect.anything() })
		);
		expect(postMessage).toHaveBeenCalledWith({ load: true });
	});
	it('reuses an untouched matching VM for preparation, claims it once, and never reuses an executed VM', async () => {
		const handle = await ready();
		await handle({ data: request({ prepare: true }) });
		await handle({
			data: request({ prepare: true, code: 'different source' })
		});
		expect(rubyInstantiateMock).toHaveBeenCalledOnce();
		expect(rubyEvalMock).not.toHaveBeenCalled();
		await handle({ data: request() });
		expect(rubyInstantiateMock).toHaveBeenCalledOnce();
		expect(rubyEvalMock).toHaveBeenCalledWith('puts 42');
		await handle({ data: request() });
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
	});
	it('binds the current fixed stdin at claim time and preserves sliced UTF-8 reads and EOF', async () => {
		const handle = await ready();
		const fd = (rubyInstantiateMock.mock.calls[0] as any)[0].wasip1.fds[0];
		rubyEvalMock.mockImplementation(() => {
			const one = fd.fd_read(2).data;
			const rest = fd.fd_read(999).data;
			expect(new TextDecoder().decode(new Uint8Array([...one, ...rest]))).toBe('한글\n');
			expect(fd.fd_read(999).data.byteLength).toBe(0);
		});
		await handle({ data: request({ prepare: true, stdin: 'obsolete' }) });
		await handle({ data: request({ stdin: '한글\n' }) });
		expect(postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect(rubyInstantiateMock).toHaveBeenCalledOnce();
	});
	it.each([
		{ args: ['value'] },
		{ workspaceFiles: [{ path: 'lib.rb', content: 'VALUE=1' }] },
		{ activePath: 'other.rb' }
	])('reinitializes for a different immutable startup context %j', async (extra) => {
		const handle = await ready();
		await handle({ data: request({ ...extra, prepare: true }) });
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
		await handle({ data: request(extra) });
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
		expect(rubyEvalMock).toHaveBeenCalledOnce();
	});
	it('does not treat program arguments as Ruby interpreter flags during preparation', async () => {
		const handle = await ready();
		const args = ['-rnetwork', '-e', 'puts "not a bootstrap program"'];
		await handle({ data: request({ args, prepare: true }) });
		const options = (rubyInstantiateMock.mock.calls[1] as any)[0];
		expect(options.args).toEqual(['ruby.wasm', '-EUTF-8', '-e_=0', '--', ...args]);
		expect(rubyEvalMock).not.toHaveBeenCalled();
	});
	it('uses private snapshots so changed workspace content cannot claim an old VM', async () => {
		const handle = await ready();
		const workspaceFiles = [{ path: 'lib.rb', content: 'old' }];
		const args = ['old'];
		await handle({ data: request({ workspaceFiles, args, prepare: true }) });
		workspaceFiles[0].content = 'new';
		args[0] = 'new';
		await handle({ data: request({ workspaceFiles, args }) });
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(3);
		const oldRoot = (rubyInstantiateMock.mock.calls[1] as any)[0].wasip1.fds[3].contents;
		const newRoot = (rubyInstantiateMock.mock.calls[2] as any)[0].wasip1.fds[3].contents;
		expect(new TextDecoder().decode(oldRoot.get('lib.rb').data)).toBe('old');
		expect(new TextDecoder().decode(newRoot.get('lib.rb').data)).toBe('new');
	});
	it('does not publish bootstrap output until the prepared VM is claimed, and flushes it once', async () => {
		let printer: any;
		runtimeModule.consolePrinter.mockImplementation((options: any) => {
			printer = options;
			return { addToImports: vi.fn(), setMemory: vi.fn() };
		});
		rubyInstantiateMock.mockImplementation(async () => {
			printer.stdout('startup\n');
			printer.stderr('warning\n');
			return { vm: { eval: rubyEvalMock } };
		});
		const handle = await ready();
		expect(postMessage).not.toHaveBeenCalledWith({ output: 'startup\n' });
		await handle({ data: request({ prepare: true }) });
		expect(postMessage).not.toHaveBeenCalledWith({ output: 'startup\n' });
		await handle({ data: request() });
		expect(
			vi.mocked(postMessage).mock.calls.filter(([value]) => value?.output === 'startup\n')
		).toHaveLength(1);
		expect(postMessage).toHaveBeenCalledWith({ output: 'warning\n' });
	});
	it('bounds staged bootstrap output and permits startup retry', async () => {
		let printer: any;
		runtimeModule.consolePrinter.mockImplementation((options: any) => {
			printer = options;
			return { addToImports: vi.fn(), setMemory: vi.fn() };
		});
		rubyInstantiateMock.mockImplementationOnce(async () => {
			printer.stdout('x'.repeat(65537));
			return { vm: { eval: rubyEvalMock } };
		});
		const handle = await ready();
		expect(postMessage).toHaveBeenCalledWith({
			error: 'Ruby initialization output exceeded 65536 bytes.'
		});
		expect(postMessage).not.toHaveBeenCalledWith({ load: true });
		await handle({ data: load });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
	});
	it('discards a speculative VM whose bootstrap consumed EOF instead of reusing poisoned stdio', async () => {
		rubyInstantiateMock.mockImplementationOnce(async (options: any) => {
			expect(options.wasip1.fds[0].fd_read(8).data.byteLength).toBe(0);
			return { vm: { eval: rubyEvalMock } };
		});
		const handle = await ready();
		expect(postMessage).not.toHaveBeenCalledWith({ buffer: true });
		let received: string | undefined;
		rubyInstantiateMock.mockImplementationOnce(async (options: any) => {
			received = new TextDecoder().decode(options.wasip1.fds[0].fd_read(8).data);
			return { vm: { eval: rubyEvalMock } };
		});
		await handle({ data: request({ stdin: 'current' }) });
		expect(received).toBe('current');
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
	});
	it('never retains user memory or globals after either successful or failed evaluation', async () => {
		const states: number[][] = [];
		rubyInstantiateMock.mockImplementation(async () => {
			const state = [0];
			states.push(state);
			return {
				vm: {
					eval: () => {
						expect(state[0]++).toBe(0);
						throw new Error('user error');
					}
				}
			};
		});
		const handle = await ready();
		await handle({ data: request() });
		await handle({ data: request() });
		expect(states).toEqual([[1], [1]]);
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
	});
	it('a rejected concurrent message cannot unlock an in-flight preparation', async () => {
		const handle = await ready();
		let finish!: (value: any) => void;
		rubyInstantiateMock.mockReturnValueOnce(
			new Promise((done) => {
				finish = done;
			})
		);
		const preparation = handle({
			data: request({ args: ['new'], prepare: true })
		});
		await handle({ data: request() });
		await handle({ data: request() });
		expect(rubyEvalMock).not.toHaveBeenCalled();
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
		finish({ vm: { eval: rubyEvalMock } });
		await preparation;
		await handle({ data: request({ args: ['new'] }) });
		expect(rubyEvalMock).toHaveBeenCalledOnce();
		expect(rubyInstantiateMock).toHaveBeenCalledTimes(2);
	});
	it('allows a fresh verified startup after VM initialization failed', async () => {
		rubyInstantiateMock.mockRejectedValueOnce(new Error('initialize failed'));
		const handle = await ready();
		expect(postMessage).not.toHaveBeenCalledWith({ load: true });
		await handle({ data: load });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
		expect(rubyEvalMock).not.toHaveBeenCalled();
	});

	it('initializes the actual bootstrap context rather than paying for a spare default VM', async () => {
		const handle = await loadWorker();
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ruby');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		const startupContext = {
			args: ['7'],
			activePath: 'program.rb',
			workspaceFiles: [{ path: 'lib.rb', content: 'VALUE=7' }]
		};
		await handle({ data: { ...load, startupContext } });
		await handle({ data: request(startupContext) });
		expect(rubyInstantiateMock).toHaveBeenCalledOnce();
		expect((rubyInstantiateMock.mock.calls[0] as any)[0].args).toEqual([
			'ruby.wasm',
			'-EUTF-8',
			'-e_=0',
			'--',
			'7'
		]);
	});
	it.each([
		null,
		{
			args: [],
			activePath: 'main.rb',
			workspaceFiles: [],
			source: 'must not execute'
		},
		{ args: [7], activePath: 'main.rb', workspaceFiles: [] },
		{ args: [], activePath: '../escape', workspaceFiles: [] },
		{
			args: [],
			activePath: 'main.rb',
			workspaceFiles: [{ path: '/escape.rb', content: 'x' }]
		}
	])(
		'rejects malformed startup metadata without evaluating or importing it: %j',
		async (startupContext) => {
			const handle = await loadWorker();
			await handle({ data: { ...load, startupContext } });
			expect(mocks.importRuntimeModule).not.toHaveBeenCalled();
			expect(rubyInstantiateMock).not.toHaveBeenCalled();
			expect(postMessage).toHaveBeenCalledWith({ error: expect.any(String) });
		}
	);
});
