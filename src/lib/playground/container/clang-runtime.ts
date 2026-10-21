import type { Container, ContainerProcess, ProcessResult } from '@wasm-idle/container';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from '../options';
import type { ProgressLike } from '@wasm-idle/core';
import type { ContainerWorkerEvent } from './protocol';
import type { WebsiteRuntimeAdapter } from './runtime-adapter';

type Profile = {
	container: Container;
	prepareCommand(invocation: unknown, signal: AbortSignal): Promise<void>;
};
interface Execution {
	language: string;
	phase: 'prepare' | 'run';
	process?: ContainerProcess;
	writer?: WritableStreamDefaultWriter<Uint8Array>;
	signal: AbortSignal;
	stopped?: boolean;
}
/** The Run button uses the same real Clang command and artifacts as Bash. Debug uses its qualified backend. */
export class WebsiteClangRuntime {
	#active = new Map<string, Execution>();
	#prepared = new Map<string, string>();
	#input = new Map<string, { chunks: string[]; size: number; eof: boolean }>();
	#header?: { key: string; path: string; bytes: Uint8Array };
	constructor(
		private readonly profile: Profile,
		private readonly files: WebsiteRuntimeAdapter,
		private readonly emit: (event: ContainerWorkerEvent) => void
	) {}
	private queue(language: string) {
		let value = this.#input.get(language);
		if (!value) this.#input.set(language, (value = { chunks: [], size: 0, eof: false }));
		return value;
	}
	private key(language: string, code: string, args: string[], options: SandboxExecutionOptions) {
		return JSON.stringify([
			language,
			code,
			args,
			options.cppVersion,
			options.cVersion,
			options.compileArgs,
			options.activePath,
			options.env,
			options.workspaceFiles
		]);
	}
	private async drain(
		process: ContainerProcess,
		language: string,
		requestId: number,
		diagnostics = false,
		quiet = false
	) {
		const output = async (stream: ReadableStream<Uint8Array>, stderr: boolean) => {
			const reader = stream.getReader(),
				decoder = new TextDecoder();
			let pending = '';
			try {
				for (;;) {
					const { value, done } = await reader.read();
					const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
					if (text && !quiet)
						this.emit({ language, name: 'output', data: text, requestId });
					if (stderr && diagnostics) {
						pending += text;
						const lines = pending.split('\n');
						pending = lines.pop() ?? '';
						for (const line of lines) {
							// Preserve terminal styling in output while editor diagnostics use plain text.
							const plain = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
							const match =
								/^(.*?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/.exec(
									plain
								);
							if (match)
								this.emit({
									language,
									name: 'diagnostic',
									requestId,
									data: {
										fileName: match[1].replace(
											`/workspace/${language}/`,
											'/workspace/'
										),
										lineNumber: Number(match[2]),
										columnNumber: Number(match[3]),
										severity: match[4].includes('error')
											? 'error'
											: match[4] === 'warning'
												? 'warning'
												: 'other',
										message: match[5]
									}
								});
						}
						if (pending.length > 65536) pending = '';
					}
					if (done) break;
				}
			} finally {
				reader.releaseLock();
			}
		};
		const [result] = await Promise.all([
			process.exited,
			output(process.stdout, false),
			output(process.stderr, true)
		]);
		return result;
	}
	private success(result: ProcessResult, signal: AbortSignal) {
		if (signal.aborted)
			throw signal.reason ?? new DOMException('Command cancelled', 'AbortError');
		if (result.reason !== 'exited')
			throw new Error(`Container command ended with ${result.reason}`);
		return result.code === 0;
	}
	private headerKey(
		language: string,
		code: string,
		compileArgs: string[],
		options: SandboxExecutionOptions,
		cwd: string,
		standard: string | undefined
	) {
		// A textual prefix and the fixed system headers are the only admitted inputs.
		// Custom arguments, environment paths, or workspace headers can alter declarations.
		if (
			language !== 'CPP' ||
			compileArgs.length ||
			Object.keys(options.env ?? {}).length ||
			options.workspaceFiles?.some(
				(file) =>
					file.path !== options.activePath && !/\.(?:c|cc|cpp|cxx|wasm)$/i.test(file.path)
			)
		)
			return;
		let rest = code.replace(/^\uFEFF/, '');
		for (;;) {
			rest = rest.replace(/^\s+/, '');
			if (rest.startsWith('//')) {
				const end = rest.indexOf('\n');
				if (end < 0 || rest.slice(0, end).trimEnd().endsWith('\\')) return;
				rest = rest.slice(end + 1);
			} else if (rest.startsWith('/*')) {
				const end = rest.indexOf('*/', 2);
				if (end < 0) return;
				rest = rest.slice(end + 2);
			} else break;
		}
		if (!/^#[ \t]*include[ \t]*<bits\/stdc\+\+\.h>/.test(rest)) return;
		return JSON.stringify([cwd, standard, '-fno-exceptions']);
	}
	private discardHeader() {
		if (!this.#header) return;
		try {
			this.profile.container.fs.unlink(this.#header.path);
		} catch {
			/* Already removed. */
		}
		this.#header = undefined;
	}
	async prepare(
		language: string,
		code: string,
		args: string[],
		options: SandboxExecutionOptions,
		signal: AbortSignal,
		progress: ProgressLike | undefined,
		requestId: number
	) {
		if (this.#active.has(language))
			throw new Error(`${language} already has an active command`);
		const input = this.files.inputs(language, code, options);
		const cwd = this.files.directory(language),
			artifact = `${cwd}/program.wasm`;
		const job: Execution = { language, phase: 'prepare', signal };
		this.#active.set(language, job);
		this.#prepared.delete(language);
		try {
			progress?.report?.({
				kind: 'activity',
				phase: 'initializing',
				label: 'Preparing the Clang toolchain'
			});
			await this.profile.prepareCommand({ path: '/usr/local/bin/clang' }, signal);
			const { compileArgs } = resolveSandboxExecutionArgs(language, args, options);
			const standard =
				language === 'CPP'
					? (options.cppVersion ?? 'CPP20').replace(/^CPP/, 'c++').toLowerCase()
					: options.cVersion?.toLowerCase();
			// An opaque response file or -x override can select C++ for a C editor.
			// Keep its default source mode C while enabling the C++ driver's link libraries.
			const override = compileArgs.some((arg) => arg.startsWith('@') || arg.startsWith('-x'));
			const common = [
				...(language === 'CPP' || override ? ['--driver-mode=g++'] : []),
				...(language === 'C' && override ? ['-x', 'c'] : []),
				...(standard ? [`-std=${standard}`] : []),
				'-fcolor-diagnostics',
				'-fno-exceptions',
				...compileArgs
			];
			const compile = async (argv: string[], quiet = false) => {
				job.process = await this.profile.container.spawn('clang', argv, {
					cwd,
					signal,
					env: options.env
				});
				const drained = this.drain(job.process, language, requestId, !quiet, quiet);
				await job.process.stdin.getWriter().close();
				const result = await drained;
				if (job.stopped) throw new DOMException('Command cancelled', 'AbortError');
				return this.success(result, signal);
			};
			const headerKey = this.headerKey(
				language,
				input.code,
				compileArgs,
				input.options,
				cwd,
				standard
			);
			if (headerKey && this.#header?.key !== headerKey) this.discardHeader();
			let header = headerKey === this.#header?.key ? this.#header : undefined;
			if (header) {
				// Restore owned bytes instead of trusting a writable temporary file.
				try {
					try {
						this.profile.container.fs.unlink(header.path);
					} catch {
						/* Already removed. */
					}
					this.profile.container.fs.writeFile(header.path, header.bytes);
				} catch {
					this.discardHeader();
					header = undefined;
				}
			}
			let okay = await compile([
				...common,
				...(header ? ['-include-pch', header.path] : []),
				input.options.activePath!,
				'-lc-printscan-long-double',
				'-o',
				artifact
			]);
			if (header && okay) progress?.set?.(95, 'Compiled with precompiled <bits/stdc++.h>');
			else if (header) {
				this.discardHeader();
				okay = await compile([
					...common,
					input.options.activePath!,
					'-lc-printscan-long-double',
					'-o',
					artifact
				]);
			}
			if (okay && headerKey && !this.#header) {
				const path = `/tmp/wasm-idle-stdcpp-${crypto.randomUUID()}.pch`;
				try {
					if (
						await compile(
							[
								...common,
								'-c',
								'-x',
								'c++-header',
								'/usr/share/wasm-sysroot/include/bits/stdc++.h',
								'-o',
								path
							],
							true
						)
					) {
						const bytes = this.profile.container.fs.readFile(path);
						if (bytes.byteLength > 0 && bytes.byteLength <= 32 * 1024 * 1024)
							this.#header = { key: headerKey, path, bytes };
					}
				} catch (error) {
					if (signal.aborted || job.stopped) throw error;
				} finally {
					if (this.#header?.path !== path) {
						try {
							this.profile.container.fs.unlink(path);
						} catch {
							/* No usable header. */
						}
					}
				}
			}
			if (okay) this.#prepared.set(language, this.key(language, input.code, args, options));
			return okay;
		} finally {
			if (this.#active.get(language) === job) this.#active.delete(language);
		}
	}
	async run(
		language: string,
		code: string,
		args: string[],
		options: SandboxExecutionOptions,
		signal: AbortSignal,
		progress: ProgressLike | undefined,
		requestId: number
	) {
		const input = this.files.inputs(language, code, options);
		if (
			this.#prepared.get(language) !== this.key(language, input.code, args, options) &&
			!(await this.prepare(language, code, args, options, signal, progress, requestId))
		)
			return false;
		const cwd = this.files.directory(language),
			job: Execution = { language, phase: 'run', signal };
		if (this.#active.has(language))
			throw new Error(`${language} already has an active command`);
		this.#active.set(language, job);
		try {
			const { programArgs } = resolveSandboxExecutionArgs(language, args, options);
			job.process = await this.profile.container.spawn(
				'wasm-run',
				[`${cwd}/program.wasm`, ...programArgs],
				{ cwd, signal, env: options.env }
			);
			job.writer = job.process.stdin.getWriter();
			progress?.report?.({
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'Container program started'
			});
			const drained = this.drain(job.process, language, requestId);
			if (options.stdin !== undefined) {
				await job.writer.write(new TextEncoder().encode(options.stdin));
				await job.writer.close();
			} else await this.flush(language);
			return this.success(await drained, signal);
		} finally {
			job.writer?.releaseLock();
			this.#input.delete(language);
			if (this.#active.get(language) === job) this.#active.delete(language);
		}
	}
	private async flush(language: string) {
		const writer = this.#active.get(language)?.writer;
		if (!writer) return;
		const queue = this.queue(language);
		for (const text of queue.chunks.splice(0)) {
			const bytes = new TextEncoder().encode(text);
			await writer.write(bytes);
			queue.size -= bytes.byteLength;
		}
		if (queue.eof) {
			queue.eof = false;
			await writer.close();
		}
	}
	async write(language: string, text: string) {
		const q = this.queue(language);
		q.size += new TextEncoder().encode(text).length;
		if (q.size > 8 * 1024 * 1024) throw new Error('Pending stdin exceeds its limit');
		q.chunks.push(text);
		await this.flush(language);
	}
	async eof(language: string) {
		this.queue(language).eof = true;
		await this.flush(language);
	}
	async stop(language: string) {
		this.#input.delete(language);
		const job = this.#active.get(language);
		if (job) job.stopped = true;
		await job?.process?.terminate();
	}
	clear(language: string) {
		this.#input.delete(language);
	}
	inspect() {
		return [...this.#active.values()].map((job) => ({
			language: job.language,
			phase: job.phase,
			pid: job.process?.pid,
			filesystem: 'live'
		}));
	}
	async dispose() {
		await Promise.allSettled([...this.#active.keys()].map((language) => this.stop(language)));
		this.discardHeader();
	}
}
