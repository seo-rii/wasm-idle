import type { Container, ContainerProcess, FileVersion, ProcessResult } from '@wasm-idle/container';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from '../options';
import type { ProgressLike } from '@wasm-idle/core';
import type { ContainerWorkerEvent } from './protocol';
import type { WebsiteRuntimeAdapter } from './runtime-adapter';

type Profile = {
	container: Container;
	sysrootProfile?: 'full' | 'c-base-v1';
	prepareCommand(invocation: unknown, signal: AbortSignal): Promise<void>;
	prepareClang?(profile: 'c' | 'full', signal: AbortSignal): Promise<readonly string[]>;
};
interface Execution {
	language: string;
	phase: 'prepare' | 'run';
	process?: ContainerProcess;
	writer?: WritableStreamDefaultWriter<Uint8Array>;
	signal: AbortSignal;
	stopped?: boolean;
}
interface PreparedProgram {
	key: string;
	generation: number;
	version: FileVersion;
	reusable: boolean;
	diagnostics: ContainerWorkerEvent[];
}
/** The Run button uses the same real Clang command and artifacts as Bash. Debug uses its qualified backend. */
export class WebsiteClangRuntime {
	#active = new Map<string, Execution>();
	#prepared = new Map<string, PreparedProgram>();
	#input = new Map<string, { chunks: string[]; size: number; eof: boolean }>();
	#header?: { key: string; path: string; bytes: Uint8Array };
	#disposed = false;
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
			resolveSandboxExecutionArgs(language, args, options).compileArgs,
			options.cppVersion,
			options.cVersion,
			options.activePath,
			options.env
		]);
	}
	private currentProgram(program: PreparedProgram | undefined, key: string, artifact: string) {
		const fs = this.profile.container.fs;
		if (!program || program.key !== key || program.generation !== fs.generation) return;
		try {
			if (
				fs.captureFileVersion(artifact) === program.version &&
				fs.stat(artifact).mode & 0o111
			)
				return program;
		} catch {
			/* A removed or replaced artifact requires a new build. */
		}
	}
	private async drain(
		process: ContainerProcess,
		language: string,
		requestId: number,
		diagnostics = false,
		quiet = false,
		emit = this.emit
	) {
		const output = async (stream: ReadableStream<Uint8Array>, stderr: boolean) => {
			const reader = stream.getReader(),
				decoder = new TextDecoder();
			let pending = '';
			try {
				for (;;) {
					const { value, done } = await reader.read();
					const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
					if (text && !quiet) emit({ language, name: 'output', data: text, requestId });
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
								emit({
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
	private discardHeader(source?: unknown) {
		if (!this.#header) return;
		try {
			this.profile.container.fs.withMutationSource(source, () =>
				this.profile.container.fs.unlink(this.#header!.path)
			);
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
		if (this.#disposed) throw new Error('Clang runtime has been disposed');
		if (this.#active.has(language))
			throw new Error(`${language} already has an active command`);
		const job: Execution = { language, phase: 'prepare', signal };
		let mutations: ReturnType<Container['fs']['observeMutations']> | undefined;
		this.#active.set(language, job);
		const previous = this.#prepared.get(language);
		this.#prepared.delete(language);
		try {
			signal.throwIfAborted();
			const input = this.files.inputs(language, code, options);
			const cwd = this.files.directory(language),
				artifact = `${cwd}/program.wasm`,
				key = this.key(language, input.code, args, input.options);
			const cached = this.currentProgram(previous, key, artifact);
			if (cached?.reusable) {
				progress?.report?.({
					kind: 'activity',
					phase: 'starting',
					label: 'Reusing the compiled program'
				});
				const current = () => {
					signal.throwIfAborted();
					if (job.stopped) throw new DOMException('Command cancelled', 'AbortError');
					return this.currentProgram(cached, key, artifact);
				};
				// Progress/output callbacks may synchronously edit the workspace. Replay
				// outputs first so an invalidation cannot leave old editor diagnostics
				// alongside the rebuild's diagnostics. Delivered output cannot be retracted.
				const replay = [
					...cached.diagnostics.filter((event) => event.name !== 'diagnostic'),
					...cached.diagnostics.filter((event) => event.name === 'diagnostic')
				];
				for (const event of replay) {
					if (!current()) break;
					this.emit({ ...structuredClone(event), requestId });
				}
				if (current()) {
					this.#prepared.set(language, cached);
					return true;
				}
			}
			progress?.report?.({
				kind: 'activity',
				phase: 'initializing',
				label: 'Preparing the Clang toolchain'
			});
			const { compileArgs } = resolveSandboxExecutionArgs(language, args, options);
			const sysrootProfile =
				this.profile.sysrootProfile === 'c-base-v1' &&
				language === 'C' &&
				input.options.activePath?.endsWith('.c') &&
				!compileArgs.length &&
				!Object.keys(options.env ?? {}).length
					? 'c'
					: 'full';
			let sysrootArgs: readonly string[] = [];
			if (this.profile.prepareClang)
				sysrootArgs = await this.profile.prepareClang(sysrootProfile, signal);
			else await this.profile.prepareCommand({ path: '/usr/local/bin/clang' }, signal);
			signal.throwIfAborted();
			if (job.stopped) throw new DOMException('Command cancelled', 'AbortError');
			// Opaque flags/response files can request additional outputs or driver side effects.
			// They retain only the immediate prepare-to-run handoff, not cross-Run reuse.
			let reusable = compileArgs.length === 0 && Object.keys(options.env ?? {}).length === 0;
			const mutationSources = new Set<unknown>([job]);
			try {
				mutations = this.profile.container.fs.observeMutations();
			} catch {
				reusable = false; /* Optional reuse must not prevent ordinary compilation. */
			}
			let diagnosticBytes = 0;
			const diagnostics: ContainerWorkerEvent[] = [];
			const emit = (event: ContainerWorkerEvent) => {
				diagnosticBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
				if (diagnostics.length < 256 && diagnosticBytes <= 64 * 1024)
					diagnostics.push(structuredClone(event));
				else reusable = false;
				this.emit(event);
			};
			let oldVersion: FileVersion | undefined;
			try {
				oldVersion = this.profile.container.fs.captureFileVersion(artifact);
			} catch {
				/* No previous output. */
			}
			const standard =
				language === 'CPP'
					? (options.cppVersion ?? 'CPP20').replace(/^CPP/, 'c++').toLowerCase()
					: options.cVersion?.toLowerCase();
			// An opaque response file or -x override can select C++ for a C editor.
			// Keep its default source mode C while enabling the C++ driver's link libraries.
			const override = compileArgs.some((arg) => arg.startsWith('@') || arg.startsWith('-x'));
			const common = [
				...sysrootArgs,
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
				mutationSources.add(job.process.mutationSource ?? job.process.pid);
				const drained = this.drain(job.process, language, requestId, !quiet, quiet, emit);
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
			if (headerKey && this.#header?.key !== headerKey) this.discardHeader(job);
			let header = headerKey === this.#header?.key ? this.#header : undefined;
			if (header) {
				// Restore owned bytes instead of trusting a writable temporary file.
				const ownedHeader = header;
				try {
					this.profile.container.fs.withMutationSource(job, () => {
						try {
							this.profile.container.fs.unlink(ownedHeader.path);
						} catch {
							/* Already removed. */
						}
						this.profile.container.fs.writeFile(ownedHeader.path, ownedHeader.bytes);
					});
				} catch {
					this.discardHeader(job);
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
				this.discardHeader(job);
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
							this.profile.container.fs.withMutationSource(job, () =>
								this.profile.container.fs.unlink(path)
							);
						} catch {
							/* No usable header. */
						}
					}
				}
			}
			if (okay) {
				if (mutations?.hasChangesOutside(mutationSources)) reusable = false;
				signal.throwIfAborted();
				if (job.stopped) throw new DOMException('Command cancelled', 'AbortError');
				const fs = this.profile.container.fs;
				try {
					const version = fs.captureFileVersion(artifact),
						stat = fs.stat(artifact);
					if (version === oldVersion || !stat.size || !(stat.mode & 0o111)) return false;
					this.#prepared.set(language, {
						key,
						generation: fs.generation,
						version,
						reusable,
						diagnostics
					});
				} catch {
					return false;
				}
			}
			return okay;
		} finally {
			mutations?.dispose();
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
		if (this.#disposed) throw new Error('Clang runtime has been disposed');
		signal.throwIfAborted();
		const input = this.files.inputs(language, code, options);
		const cwd = this.files.directory(language),
			artifact = `${cwd}/program.wasm`;
		if (
			!this.currentProgram(
				this.#prepared.get(language),
				this.key(language, input.code, args, input.options),
				artifact
			) &&
			!(await this.prepare(language, code, args, options, signal, progress, requestId))
		)
			return false;
		const program = this.currentProgram(
			this.#prepared.get(language),
			this.key(language, input.code, args, input.options),
			artifact
		);
		if (!program) return false;
		if (!program.reusable) this.#prepared.delete(language);
		const job: Execution = { language, phase: 'run', signal };
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
		this.#disposed = true;
		this.#prepared.clear();
		await Promise.allSettled([...this.#active.keys()].map((language) => this.stop(language)));
		this.discardHeader();
	}
}
