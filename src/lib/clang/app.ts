import type { DebugFrame, DebugVariable, DebugVariableMetadata } from '$lib/playground/options';
import { bindNew } from '$lib/clang/apply';
import { Memory, type MemFS } from '$lib/clang/memory';
import { getInstance } from '$lib/clang/wasm';
import { AbortError, NotImplemented, ProcExit } from '$lib/clang/error';

const ESUCCESS = 0;
const RAF_PROC_EXIT_CODE = 0xc0c0a;

interface DebugSession {
	buffer?: Int32Array;
	interruptBuffer?: Uint8Array;
	breakpoints: Set<number>;
	pauseOnEntry: boolean;
	stepArmed: boolean;
	nextLineArmed: boolean;
	stepOutArmed: boolean;
	callDepth: number;
	stepOutDepth: number;
	currentFunctionId: number;
	currentLine: number;
	resumeSkipActive: boolean;
	resumeSkipFunctionId: number;
	resumeSkipLine: number;
	nextLineFunctionId: number;
	nextLineLine: number;
	variableMetadata: Record<number, DebugVariableMetadata[]>;
	globalVariableMetadata: DebugVariableMetadata[];
	functionMetadata: Record<number, string>;
	frames: Array<{ functionId: number; functionName: string; line: number; values: Map<number, string> }>;
	globalValues: Map<number, string>;
	onPause?: (event: {
		type: 'pause';
		line: number;
		reason: string;
		locals: DebugVariable[];
		callStack: DebugFrame[];
	}) => void;
}

export default class App {
	ready: Promise<void>;

	mem: Memory = <any>null;
	memfs: MemFS;
	instance: WebAssembly.Instance = <any>null;
	exports: any;
	trace: (message: string) => void = () => {};
	debugSession?: DebugSession;

	argv: string[];
	environ: { [key: string]: string };
	handles = new Map<number, any>();
	nextHandle = 0;

	constructor(module: WebAssembly.Module, memfs: MemFS, name: string, ...args: string[]) {
		this.argv = [name, ...args];
		this.environ = { USER: 'jungol' };
		this.memfs = memfs;

		const env = bindNew(
			this,
			'__wasm_idle_debug_enter',
			'__wasm_idle_debug_leave',
			'__wasm_idle_debug_line',
			'__wasm_idle_debug_value_num',
			'__wasm_idle_debug_value_bool',
			'__wasm_idle_debug_value_addr',
			'__wasm_idle_debug_value_text'
		);

		const wasi_unstable = {
			...bindNew(
				this,
				'proc_exit',
				'environ_sizes_get',
				'environ_get',
				'args_sizes_get',
				'args_get',
				'random_get',
				'clock_time_get',
				'poll_oneoff'
			),
			...this.memfs.exports
		};

		this.ready = getInstance(module, { wasi_unstable, env }).then((instance) => {
			this.instance = instance;
			this.exports = this.instance.exports;
			this.mem = new Memory(this.exports.memory);
			this.memfs.hostMem = this.mem;
		});
	}

	async run() {
		await this.ready;
		this.trace(
			`start(argv=${JSON.stringify(this.argv)}, exports=${JSON.stringify(
				Object.keys(this.exports || {})
			)})`
		);
		try {
			this.exports._start();
		} catch (exn: any) {
			let writeStack = true;
			if (exn instanceof ProcExit) {
				this.trace(`proc_exit(code=${exn.code})`);
				if (exn.code === RAF_PROC_EXIT_CODE) {
					console.log('Allowing rAF after exit.');
					return true;
				}
				// Don't allow rAF unless you return the right code.
				console.log(`Disallowing rAF since exit code is ${exn.code}.`);
				if (exn.code == 0) return false;
				writeStack = false;
			}
			if (exn instanceof NotImplemented) this.trace(`not_implemented(${exn.message})`);

			// Write error message.
			let msg = `\x1b[91mError: ${exn.message}`;
			if (writeStack) msg = msg + `\n${exn.stack}`;
			msg += '\x1b[0m\n';
			this.memfs.stdout(msg);

			// Propagate error.
			throw exn;
		}
		this.trace('start() returned without proc_exit');
	}

	proc_exit(code: number) {
		throw new ProcExit(code);
	}

	private pauseDebugSession(session: DebugSession, functionId: number, line: number, reason: string) {
		const buffer = session.buffer;
		if (!buffer) return ESUCCESS;
		session.currentFunctionId = functionId;
		session.currentLine = line;
		const frame = [...session.frames].reverse().find((candidate) => candidate.functionId === functionId);
		if (frame) frame.line = line;
		session.pauseOnEntry = false;
		session.stepArmed = false;
		session.nextLineArmed = false;
		session.stepOutArmed = false;
		this.trace(`pause(function=${functionId}, line=${line}, reason=${reason})`);
		const locals =
			session.variableMetadata[functionId]?.flatMap((variable) => {
				if (line < variable.fromLine || line > variable.toLine) return [];
				if (variable.kind === 'array') {
					this.mem?.check?.();
					const address = Number(frame?.values.get(variable.slot) ?? Number.NaN);
					const dimensions =
						variable.dimensions?.length
							? variable.dimensions
							: variable.length
								? [variable.length]
								: [];
					if (!Number.isFinite(address) || address <= 0 || !dimensions.length || !variable.elementKind) {
						return [{ name: variable.name, value: '?' }];
					}
					const elementStride =
						variable.elementKind === 'double'
							? 8
							: variable.elementKind === 'bool' || variable.elementKind === 'char'
								? 1
								: 4;
					if (dimensions.length === 2) {
						const previewRows = Math.min(dimensions[0], 4);
						const previewCols = Math.min(dimensions[1], 8);
						const rows: string[] = [];
						for (let row = 0; row < previewRows; row += 1) {
							const values: string[] = [];
							for (let col = 0; col < previewCols; col += 1) {
								const offset = address + (row * dimensions[1] + col) * elementStride;
								if (variable.elementKind === 'bool') {
									values.push(this.mem.read8(offset) ? 'true' : 'false');
									continue;
								}
								if (variable.elementKind === 'char') {
									const charCode = this.mem.read8(offset);
									values.push(
										charCode >= 0x20 && charCode <= 0x7e ? `'${String.fromCharCode(charCode)}'` : `${charCode}`
									);
									continue;
								}
								if (variable.elementKind === 'float') {
									values.push(`${this.mem.readFloat32(offset)}`);
									continue;
								}
								if (variable.elementKind === 'double') {
									values.push(`${this.mem.readFloat64(offset)}`);
									continue;
								}
								values.push(`${this.mem.readInt32(offset)}`);
							}
							rows.push(
								`[${values.join(', ')}${dimensions[1] > previewCols ? ', ...' : ''}]`
							);
						}
						return [
							{
								name: variable.name,
								value: `[${rows.join(', ')}${dimensions[0] > previewRows ? ', ...' : ''}]`
							}
						];
					}
					const previewLength = Math.min(dimensions[0], 8);
					const values: string[] = [];
					for (let index = 0; index < previewLength; index += 1) {
						const offset = address + index * elementStride;
						if (variable.elementKind === 'bool') {
							values.push(this.mem.read8(offset) ? 'true' : 'false');
							continue;
						}
						if (variable.elementKind === 'char') {
							const charCode = this.mem.read8(offset);
							values.push(
								charCode >= 0x20 && charCode <= 0x7e ? `'${String.fromCharCode(charCode)}'` : `${charCode}`
							);
							continue;
						}
						if (variable.elementKind === 'float') {
							values.push(`${this.mem.readFloat32(offset)}`);
							continue;
						}
						if (variable.elementKind === 'double') {
							values.push(`${this.mem.readFloat64(offset)}`);
							continue;
						}
						values.push(`${this.mem.readInt32(offset)}`);
					}
					return [
						{
							name: variable.name,
							value: `[${values.join(', ')}${dimensions[0] > previewLength ? ', ...' : ''}]`
						}
					];
				}
				const value = frame?.values.get(variable.slot) ?? '?';
				return [{ name: variable.name, value }];
			}) || [];
		const localNames = new Set(locals.map((variable) => variable.name));
		const globals =
			(session.globalVariableMetadata || []).flatMap((variable) => {
				if (localNames.has(variable.name)) return [];
				if (line < variable.fromLine || line > variable.toLine) return [];
				const value = session.globalValues?.get(variable.slot) ?? '?';
				return [{ name: variable.name, value }];
			}) || [];
		session.onPause?.({
			type: 'pause',
			line,
			reason,
			locals: [...locals, ...globals],
			callStack: [...session.frames]
				.reverse()
				.map((stackFrame) => ({ functionName: stackFrame.functionName, line: stackFrame.line }))
		});
		const sequence = Atomics.load(buffer, 0);
		while (true) {
			if (session.interruptBuffer?.[0] === 2) throw new AbortError();
			Atomics.wait(buffer, 0, sequence, 100);
			if (session.interruptBuffer?.[0] === 2) throw new AbortError();
			const command = Atomics.exchange(buffer, 1, 0);
			if (command === 1) {
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 2) {
				session.stepArmed = true;
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 3) {
				session.nextLineArmed = true;
				session.nextLineFunctionId = session.currentFunctionId;
				session.nextLineLine = session.currentLine;
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
			if (command === 4) {
				session.stepOutArmed = true;
				session.stepOutDepth = Math.max(0, session.callDepth - 1);
				session.resumeSkipActive = true;
				session.resumeSkipFunctionId = session.currentFunctionId;
				session.resumeSkipLine = session.currentLine;
				return ESUCCESS;
			}
		}
	}

	__wasm_idle_debug_enter(functionId: number, line: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		session.callDepth += 1;
		session.currentFunctionId = functionId;
		session.currentLine = line;
		session.frames.push({
			functionId,
			functionName: session.functionMetadata[functionId] || `fn_${functionId}`,
			line,
			values: new Map()
		});
		this.trace(`enter(function=${functionId}, line=${line}, depth=${session.callDepth})`);
		if (session.pauseOnEntry) {
			return this.pauseDebugSession(session, functionId, line, 'entry');
		}
		if (session.stepArmed) {
			return this.pauseDebugSession(session, functionId, line, 'step');
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_leave(functionId: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		this.trace(`leave(function=${functionId}, depth=${session.callDepth})`);
		if (session.nextLineArmed && functionId === session.nextLineFunctionId) {
			session.nextLineArmed = false;
			session.stepArmed = true;
		}
		session.callDepth = Math.max(0, session.callDepth - 1);
		if (session.currentFunctionId === functionId) session.currentFunctionId = 0;
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			if (session.frames[index]?.functionId === functionId) {
				session.frames.splice(index, 1);
				break;
			}
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_num(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, Number.isInteger(value) ? String(value) : `${value}`);
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, Number.isInteger(value) ? String(value) : `${value}`);
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_bool(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, value ? 'true' : 'false');
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, value ? 'true' : 'false');
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_addr(functionId: number, slot: number, value: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (functionId === 0) {
			session.globalValues.set(slot, String(value >>> 0));
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, String(value >>> 0));
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_value_text(functionId: number, slot: number, ptr: number, len: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		this.mem?.check?.();
		const text = this.mem?.readStr ? this.mem.readStr(ptr, len) : '?';
		if (functionId === 0) {
			session.globalValues.set(slot, text);
			return ESUCCESS;
		}
		for (let index = session.frames.length - 1; index >= 0; index -= 1) {
			const frame = session.frames[index];
			if (frame?.functionId !== functionId) continue;
			frame.values.set(slot, text);
			break;
		}
		return ESUCCESS;
	}

	__wasm_idle_debug_line(functionId: number, line: number) {
		const session = this.debugSession;
		if (!session?.buffer) return ESUCCESS;
		if (session.resumeSkipActive) {
			if (functionId === session.resumeSkipFunctionId && line === session.resumeSkipLine) {
				return ESUCCESS;
			}
			session.resumeSkipActive = false;
			session.resumeSkipFunctionId = 0;
			session.resumeSkipLine = 0;
		}
		let reason = '';
		if (session.pauseOnEntry) reason = 'entry';
		else if (session.breakpoints.has(line)) reason = 'breakpoint';
		else if (session.stepArmed) reason = 'step';
		else if (
			session.nextLineArmed &&
			functionId === session.nextLineFunctionId &&
			line !== session.nextLineLine
		) {
			reason = 'nextLine';
		} else if (session.stepOutArmed && session.callDepth <= session.stepOutDepth) {
			reason = 'stepOut';
		}
		if (!reason) return ESUCCESS;
		return this.pauseDebugSession(session, functionId, line, reason);
	}

	environ_sizes_get(environ_count_out: number, environ_buf_size_out: number) {
		this.mem.check();
		let size = 0;
		const names = Object.getOwnPropertyNames(this.environ);
		for (const name of names) {
			const value = this.environ[name];
			// +2 to account for = and \0 in "name=value\0".
			size += name.length + value.length + 2;
		}
		this.mem.write64(environ_count_out, names.length);
		this.mem.write64(environ_buf_size_out, size);
		return ESUCCESS;
	}

	environ_get(environ_ptrs: number, environ_buf: number) {
		this.mem.check();
		const names = Object.getOwnPropertyNames(this.environ);
		for (const name of names) {
			this.mem.write32(environ_ptrs, environ_buf);
			environ_ptrs += 4;
			environ_buf += this.mem.writeStr(environ_buf, `${name}=${this.environ[name]}`);
		}
		this.mem.write32(environ_ptrs, 0);
		return ESUCCESS;
	}

	args_sizes_get(argc_out: number, argv_buf_size_out: number) {
		this.mem.check();
		let size = 0;
		for (let arg of this.argv) {
			size += arg.length + 1; // "arg\0".
		}
		this.mem.write64(argc_out, this.argv.length);
		this.mem.write64(argv_buf_size_out, size);
		return ESUCCESS;
	}

	args_get(argv_ptrs: number, argv_buf: number) {
		this.mem.check();
		for (let arg of this.argv) {
			this.mem.write32(argv_ptrs, argv_buf);
			argv_ptrs += 4;
			argv_buf += this.mem.writeStr(argv_buf, arg);
		}
		this.mem.write32(argv_ptrs, 0);
		return ESUCCESS;
	}

	random_get(buf: number, buf_len: number) {
		const data = new Uint8Array(this.mem.buffer, buf, buf_len);
		for (let i = 0; i < buf_len; ++i) data[i] = (Math.random() * 256) | 0;
	}

	clock_time_get() {
		throw new NotImplemented('wasi_unstable', 'clock_time_get');
	}

	poll_oneoff() {
		throw new NotImplemented('wasi_unstable', 'poll_oneoff');
	}
}
