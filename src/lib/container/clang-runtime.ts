import type {
	Container,
	ContainerProcess,
	FileVersion,
	HostCommandInvocation,
	ProcessResult
} from '@wasm-idle/container';
import {
	resolveSandboxExecutionArgs,
	type SandboxExecutionOptions
} from '../playground/options.js';
import {
	createRuntimeGeneratedAssetCacheBackend,
	resolveRuntimeAssetCacheOptions,
	type ProgressLike,
	type RuntimeGeneratedAssetCacheBackend
} from '@wasm-idle/core';
import {
	CLANG_WASI_DRIVER_TARGET,
	isClangWorkspaceTranslationUnit,
	resolveClangLanguageArgs
} from '@wasm-idle/llvm-core/core/clang-profile';
import { CLANG_SIMD_INCLUDE_PATH } from '@wasm-idle/llvm-core/core/clang-simd';
import type { ContainerWorkerEvent } from './protocol.js';
import type { WebsiteRuntimeAdapter } from './runtime-adapter.js';

type Profile = {
	container: Container;
	sysrootProfile?: 'full' | 'c-base-v1';
	prepareCommand(invocation: HostCommandInvocation, signal: AbortSignal): Promise<void>;
	prepareClang?(profile: 'c' | 'full', signal: AbortSignal): Promise<readonly string[]>;
	/** Pinned compiler and prepared sysroot identity; enables persisting the header. */
	toolchainIdentity?(profile: 'c' | 'full'): string | undefined;
};
interface Header {
	key: string;
	path: string;
	bytes: Uint8Array;
	persistentKey?: string;
}
interface HeaderPlan {
	key: string;
	persistentKey?: string;
	language: string;
	argv: string[];
	cwd: string;
	env?: Record<string, string>;
}
// Clang rejects an incompatible precompiled header with one of these diagnostics.
const headerRejection = /precompiled (header|file)|PCH file|AST file/i;
const MAX_HEADER_BYTES = 32 * 1024 * 1024;
interface Execution {
	language: string;
	phase: 'prepare' | 'run';
	process?: ContainerProcess;
	writer?: WritableStreamDefaultWriter<Uint8Array>;
	signal: AbortSignal;
	controller: AbortController;
}
interface PreparedProgram {
	key: string;
	generation: number;
	version: FileVersion;
	reusable: boolean;
	diagnostics: ContainerWorkerEvent[];
}
/** Run uses the real Clang command with owner-managed outputs. Debug uses its qualified backend. */
export class ContainerClangRuntime {
	#active = new Map<string, Execution>();
	#prepared = new Map<string, PreparedProgram>();
	#artifactDirectory?: { path: string; inode: number };
	#artifactVersions = new Map<string, FileVersion>();
	#input = new Map<string, { chunks: string[]; size: number; eof: boolean }>();
	#header?: Header;
	#pendingHeader?: HeaderPlan;
	#headerBuild?: {
		key: string;
		language: string;
		controller: AbortController;
		promise: Promise<void>;
	};
	#headerCache?: RuntimeGeneratedAssetCacheBackend;
	#disposed = false;
	constructor(
		private readonly profile: Profile,
		private readonly files: WebsiteRuntimeAdapter,
		private readonly emit: (event: ContainerWorkerEvent) => void,
		options: { headerCache?: RuntimeGeneratedAssetCacheBackend } = {}
	) {
		this.#headerCache = options.headerCache;
	}
	private get headerCache() {
		return (this.#headerCache ??= createRuntimeGeneratedAssetCacheBackend(
			resolveRuntimeAssetCacheOptions()
		));
	}
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
	private artifact(language: string) {
		const fs = this.profile.container.fs;
		if (this.#artifactDirectory) {
			try {
				const current = fs.lstat(this.#artifactDirectory.path);
				if (current.type === 'directory' && current.inode === this.#artifactDirectory.inode)
					return `${this.#artifactDirectory.path}/${language}.wasm`;
			} catch {
				/* A removed owner directory is replaced without adopting an existing path. */
			}
		}
		// Compiler qualification stays under /workspace, while editable/saved projects
		// are confined to /workspace/<LANG>. Never reuse a user-created directory.
		for (let attempt = 0; attempt < 8; attempt++) {
			const path = `/workspace/.wasm-idle-run-${crypto.randomUUID()}`;
			try {
				fs.mkdir(path);
			} catch (error) {
				if ((error as { code?: string }).code === 'EEXIST') continue;
				throw error;
			}
			this.#artifactDirectory = { path, inode: fs.lstat(path).inode };
			return `${path}/${language}.wasm`;
		}
		throw new Error('Could not allocate a private compiler output directory');
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
	private async spawn(
		job: Execution,
		command: string,
		args: string[],
		options: { cwd: string; env?: Record<string, string> }
	) {
		job.signal.throwIfAborted();
		const process = await this.profile.container.spawn(command, args, {
			...options,
			signal: job.signal
		});
		job.process = process;
		// Stop may arrive while Container is still admitting the process. Keep the
		// returned handle inside the same cancellation boundary before using it.
		if (job.signal.aborted) {
			await process.terminate().catch(() => {});
			job.signal.throwIfAborted();
		}
		return process;
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
	/**
	 * Fetch and mount the toolchain and sysroot that a default Run of this language uses.
	 * Package fetches are shared per consumer signal, so a Run started meanwhile keeps
	 * its own preparation alive when this speculative request is cancelled.
	 */
	async prewarm(language: string, signal: AbortSignal) {
		if (this.#disposed || (language !== 'C' && language !== 'CPP')) return false;
		signal.throwIfAborted();
		if (this.profile.prepareClang)
			await this.profile.prepareClang(
				language === 'C' && this.profile.sysrootProfile === 'c-base-v1' ? 'c' : 'full',
				signal
			);
		else
			await this.profile.prepareCommand(
				{
					path: '/usr/local/bin/clang',
					argv: ['clang'],
					env: [],
					// A speculative request must not create workspace directories.
					cwd: '/workspace',
					stdin: null,
					stdout: null,
					stderr: null
				},
				signal
			);
		return !signal.aborted;
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
		const controller = new AbortController();
		signal = AbortSignal.any([signal, controller.signal]);
		const job: Execution = { language, phase: 'prepare', controller, signal };
		let mutations: ReturnType<Container['fs']['observeMutations']> | undefined;
		this.#active.set(language, job);
		const previous = this.#prepared.get(language);
		this.#prepared.delete(language);
		try {
			signal.throwIfAborted();
			const input = this.files.inputs(language, code, options);
			const cwd = this.files.directory(language),
				artifact = this.artifact(language),
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
			const activePath = input.options.activePath!;
			const sources = [
				...new Set([
					activePath,
					...(input.options.workspaceFiles ?? [])
						.map((file) => file.path)
						.filter(isClangWorkspaceTranslationUnit)
				])
			].sort();
			const sysrootProfile =
				this.profile.sysrootProfile === 'c-base-v1' &&
				language === 'C' &&
				activePath.endsWith('.c') &&
				sources.every((path) => path.endsWith('.c')) &&
				!compileArgs.length &&
				!Object.keys(options.env ?? {}).length
					? 'c'
					: 'full';
			let sysrootArgs: readonly string[] = [];
			if (this.profile.prepareClang)
				sysrootArgs = await this.profile.prepareClang(sysrootProfile, signal);
			else
				await this.profile.prepareCommand(
					{
						path: '/usr/local/bin/clang',
						argv: ['clang'],
						env: Object.entries(options.env ?? {}).map(([name, value]) =>
							new TextEncoder().encode(`${name}=${value}`)
						),
						cwd,
						stdin: null,
						stdout: null,
						stderr: null
					},
					signal
				);
			signal.throwIfAborted();
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
			const filenameCpp = /\.(?:cc|cpp|cxx|C)$/.test(activePath);
			const filenameLanguage = language === 'CPP' || filenameCpp ? 'CPP' : 'C';
			type Source = { path: string; mode: string | undefined };
			const sourceLanguage = ({ path, mode }: Source) => {
				if (!mode) {
					if (path === activePath) return filenameLanguage;
					return path.endsWith('.c') ? 'C' : 'CPP';
				}
				if (mode === 'c' || mode === 'c-header' || mode === 'cpp-output') return 'C';
				if (mode === 'c++' || mode === 'c++-header' || mode === 'c++-cpp-output')
					return 'CPP';
			};
			let mode: string | undefined;
			let omitBuiltinIncludes = false;
			let responseFile = false;
			const modeSwitches = new Map<number, string | undefined>();
			const inputModes = new Map<number, string | undefined>();
			const explicitSources = new Map<number, Source>();
			const standards = new Map<number, 'C' | 'CPP'>();
			const projectSources = new Set(sources);
			for (let index = 0; index < compileArgs.length; index++) {
				const argument = compileArgs[index];
				// Paths and forwarded arguments can themselves start with -x or @.
				if (
					[
						'-I',
						'-isystem',
						'-iquote',
						'-idirafter',
						'-include',
						'-include-pch',
						'-imacros',
						'-isysroot',
						'--sysroot',
						'-resource-dir',
						'-D',
						'-U',
						'-o',
						'-L',
						'-l',
						'-B',
						'-target',
						'--target',
						'-Xclang',
						'-Xpreprocessor',
						'-Xassembler',
						'-Xlinker',
						'-mllvm',
						'-MF',
						'-MT',
						'-MQ',
						'-u',
						'-T',
						'-z',
						'-framework',
						'-F',
						'-iframework',
						'-isystem-after',
						'-include-pth',
						'-gcc-toolchain',
						'--gcc-toolchain',
						'-arch'
					].includes(argument)
				) {
					index++;
					continue;
				}
				if (argument === '-nostdinc' || argument === '-nobuiltininc')
					omitBuiltinIncludes = true;
				if (argument.startsWith('@')) {
					// A response file may name inputs or change -x. Preserve that driver invocation.
					responseFile = true;
					mode = '@';
				} else if (argument.startsWith('-x')) {
					const switchIndex = index;
					const value = argument === '-x' ? compileArgs[++index] : argument.slice(2);
					mode = value === 'none' ? undefined : value;
					modeSwitches.set(switchIndex, mode);
				} else if (/^--?std=/.test(argument)) {
					standards.set(index, argument.includes('++') ? 'CPP' : 'C');
				} else if (!argument.startsWith('-')) {
					inputModes.set(index, mode);
					try {
						const absolute = this.profile.container.fs.realpath(argument, { cwd });
						const path = absolute.slice(cwd.length + 1);
						if (
							absolute.startsWith(cwd + '/') &&
							(projectSources.has(path) || mode === 'c' || mode === 'c++')
						)
							explicitSources.set(index, { path, mode });
					} catch {
						// Clang reports missing or external inputs with its normal diagnostics.
					}
				}
			}
			const named = new Set([...explicitSources.values()].map((source) => source.path));
			const autoSources = (responseFile ? [activePath] : sources)
				.filter((path) => !named.has(path))
				.map((path) => ({ path, mode }));
			const units = [...explicitSources.values(), ...autoSources];
			const cUnits = units.filter((source) => sourceLanguage(source) === 'C');
			const hasCpp = units.some((source) => sourceLanguage(source) === 'CPP');
			const mixed = !responseFile && cUnits.length > 0 && hasCpp;
			let finalLanguage = sourceLanguage({ path: activePath, mode });
			if (!responseFile) {
				if (hasCpp) finalLanguage = 'CPP';
				else if (cUnits.length === units.length) finalLanguage = 'C';
			}
			// Opaque response files choose their own source mode and standard.
			const standard = finalLanguage
				? resolveClangLanguageArgs(finalLanguage, options).standardArg.slice('-std='.length)
				: undefined;
			// An opaque response file or -x override can select C++ for a C editor.
			// Keep its default source mode C while enabling the C++ driver's link libraries.
			const override = compileArgs.some((arg) => arg.startsWith('@') || arg.startsWith('-x'));
			const profileArgs: string[] = [];
			for (let index = 0; index < sysrootArgs.length; index++) {
				// The compatibility headers follow the driver's builtin-header policy.
				// Keep target flags and the macro guard when builtin lookup is disabled.
				if (
					omitBuiltinIncludes &&
					sysrootArgs[index] === '-isystem' &&
					sysrootArgs[index + 1]?.endsWith(`/${CLANG_SIMD_INCLUDE_PATH}`)
				) {
					index++;
					continue;
				}
				profileArgs.push(sysrootArgs[index]);
			}
			// The driver accepts one -std for all its inputs. In a mixed project, compile the
			// C units to private objects first, then link those alongside the C++ sources.
			const cObjects = new Map(
				(mixed ? cUnits : []).map((source) => [
					source,
					artifact + '.' + crypto.randomUUID() + '.o'
				])
			);
			let linkMode: string | undefined;
			// A generated object always needs filename inference. Restore an explicit -x
			// only when the next operand needs it, so trailing switches do not trip -Werror.
			const linkInput = (path: string, wantedMode: string | undefined, source?: Source) => {
				const object = source && cObjects.get(source);
				if (object) wantedMode = undefined;
				if (!mixed || wantedMode === linkMode) return [object ?? path];
				linkMode = wantedMode;
				return ['-x', wantedMode ?? 'none', object ?? path];
			};
			const userArgs = compileArgs.flatMap((arg, index) => {
				if (mixed && standards.get(index) === 'C') return [];
				if (modeSwitches.has(index)) linkMode = modeSwitches.get(index);
				return inputModes.has(index)
					? linkInput(arg, inputModes.get(index), explicitSources.get(index))
					: [arg];
			});
			const inputPath = (path: string) => (/^[-@]/.test(path) ? './' + path : path);
			const autoInputs = autoSources.flatMap((source) =>
				linkInput(inputPath(source.path), source.mode, source)
			);
			const common = [
				...profileArgs,
				`--target=${CLANG_WASI_DRIVER_TARGET}`,
				...(finalLanguage !== 'C' ? ['--driver-mode=g++'] : []),
				...(!mixed && language === 'C' && override && !filenameCpp ? ['-x', 'c'] : []),
				...(standard ? [`-std=${standard}`] : []),
				'-fcolor-diagnostics',
				'-fno-exceptions',
				...userArgs
			];
			const compile = async (argv: string[], quiet = false, sink = emit) => {
				job.process = await this.spawn(job, 'clang', argv, {
					cwd,
					env: options.env
				});
				mutationSources.add(job.process.mutationSource ?? job.process.pid);
				const drained = this.drain(job.process, language, requestId, !quiet, quiet, sink);
				await job.process.stdin.getWriter().close();
				const result = await drained;
				return this.success(result, job.signal);
			};
			const headerKey =
				units.length > 1
					? undefined
					: this.headerKey(
							language,
							input.code,
							compileArgs,
							input.options,
							cwd,
							standard
						);
			// A Run started during the background header build waits for that build rather
			// than parsing the header itself; a different header supersedes it.
			const building = this.#headerBuild;
			if (building) {
				if (building.key !== headerKey)
					building.controller.abort(
						new DOMException('Header build superseded', 'AbortError')
					);
				const stopBuild = () => building.controller.abort(signal.reason);
				signal.addEventListener('abort', stopBuild, { once: true });
				try {
					await building.promise;
				} finally {
					signal.removeEventListener('abort', stopBuild);
				}
				signal.throwIfAborted();
			}
			// No timestamps: every page load mounts the sysroot afresh, so mtimes always differ.
			// The persistent key pins the compiler, the mounted sysroot and these arguments.
			const headerArgs = [
				...common,
				'-Xclang',
				'-fno-pch-timestamp',
				'-c',
				'-x',
				'c++-header',
				'/usr/share/wasm-sysroot/include/bits/stdc++.h',
				'-o'
			];
			const identity = headerKey ? this.profile.toolchainIdentity?.('full') : undefined;
			const persistentKey = identity
				? JSON.stringify(['container-stdcpp-pch-v1', identity, headerKey, headerArgs])
				: undefined;
			if (headerKey && this.#header?.key !== headerKey) this.discardHeader(job);
			if (headerKey && !this.#header && persistentKey) {
				const bytes = await this.headerCache
					.read(persistentKey, signal)
					.catch(() => undefined);
				signal.throwIfAborted();
				if (bytes?.byteLength && bytes.byteLength <= MAX_HEADER_BYTES && !this.#header)
					this.#header = {
						key: headerKey,
						path: `/tmp/wasm-idle-stdcpp-${crypto.randomUUID()}.pch`,
						bytes,
						persistentKey
					};
			}
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
			const textual = [...common, ...autoInputs, '-lc-printscan-long-double', '-o', artifact];
			let okay: boolean;
			if (mixed) {
				const cArgs = compileArgs.filter(
					(_, index) => !inputModes.has(index) && standards.get(index) !== 'CPP'
				);
				try {
					for (const [source, object] of cObjects) {
						if (
							!(await compile([
								...profileArgs,
								`--target=${CLANG_WASI_DRIVER_TARGET}`,
								resolveClangLanguageArgs('C', options).standardArg,
								'-fcolor-diagnostics',
								'-fno-exceptions',
								'-Qunused-arguments',
								...cArgs,
								'-x',
								source.mode ?? 'c',
								'-c',
								inputPath(source.path),
								'-o',
								object
							]))
						)
							return false;
					}
					okay = await compile(textual);
				} finally {
					// Clean before capturing the reusable executable's filesystem generation.
					const fs = this.profile.container.fs;
					fs.withMutationSource(job, () => {
						for (const object of cObjects.values()) {
							try {
								fs.unlink(object);
							} catch (error) {
								if ((error as { code?: string }).code !== 'ENOENT') throw error;
							}
						}
					});
				}
			} else if (header) {
				// Hold output until Clang accepts the header, as the worker runtime does, so a
				// rejected header never shows its errors next to the textual compile's.
				const buffered: ContainerWorkerEvent[] = [];
				okay = await compile(
					[...common, '-include-pch', header.path, ...textual.slice(common.length)],
					false,
					(event) => {
						buffered.push(event);
					}
				);
				const output = buffered
					.map((event) =>
						event.name === 'output' && typeof event.data === 'string' ? event.data : ''
					)
					.join('');
				if (!okay && headerRejection.test(output)) {
					const rejected = header;
					this.discardHeader(job);
					if (rejected.persistentKey)
						void this.headerCache.remove(rejected.persistentKey).catch(() => {});
					okay = await compile(textual);
				} else {
					// Ordinary source errors keep the header: they would recur without it.
					for (const event of buffered) emit(event);
					if (okay) progress?.set?.(95, 'Compiled with precompiled <bits/stdc++.h>');
				}
			} else okay = await compile(textual);
			// Build the header once the program has run (see run), so the first Run does not
			// wait for it and the build never competes with the program for the CPU.
			if (okay && headerKey && !this.#header)
				this.#pendingHeader = {
					key: headerKey,
					persistentKey,
					language,
					argv: headerArgs,
					cwd,
					env: options.env
				};
			if (okay) {
				if (mutations?.hasChangesOutside(mutationSources)) reusable = false;
				signal.throwIfAborted();
				const fs = this.profile.container.fs;
				try {
					const version = fs.captureFileVersion(artifact),
						stat = fs.stat(artifact);
					if (version === oldVersion || !stat.size || !(stat.mode & 0o111)) return false;
					this.#artifactVersions.set(artifact, version);
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
			artifact = this.artifact(language);
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
		const controller = new AbortController();
		signal = AbortSignal.any([signal, controller.signal]);
		const job: Execution = { language, phase: 'run', controller, signal };
		if (this.#active.has(language))
			throw new Error(`${language} already has an active command`);
		this.#active.set(language, job);
		let admitted: ContainerProcess | undefined, drained: Promise<ProcessResult> | undefined;
		try {
			const { programArgs } = resolveSandboxExecutionArgs(language, args, options);
			job.process = admitted = await this.spawn(job, 'wasm-run', [artifact, ...programArgs], {
				cwd,
				env: options.env
			});
			job.writer = job.process.stdin.getWriter();
			drained = this.drain(job.process, language, requestId);
			// A callback or stdin failure must not leave an output rejection unobserved.
			void drained.catch(() => {});
			progress?.report?.({
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'Container program started'
			});
			const send = async () => {
				try {
					if (options.stdin !== undefined) {
						await job.writer!.write(new TextEncoder().encode(options.stdin));
						await job.writer!.close();
					} else await this.flush(language);
				} catch (error) {
					// A guest can close stdin before consuming the supplied input. Its
					// exit status, cancellation and remaining output still decide the result.
					if ((error as { code?: string } | null)?.code !== 'EPIPE') throw error;
				}
			};
			const [result] = await Promise.all([drained, send()]);
			return this.success(result, job.signal);
		} catch (error) {
			try {
				await admitted?.terminate();
			} catch {
				/* Preserve the original execution or I/O failure. */
			}
			await drained?.catch(() => {});
			throw error;
		} finally {
			job.writer?.releaseLock();
			this.#input.delete(language);
			if (this.#active.get(language) === job) this.#active.delete(language);
			if (this.#pendingHeader) void this.buildPendingHeader();
		}
	}
	/**
	 * Build the header an earlier compile planned. Run starts this after its program exits;
	 * the next compile of the same header waits for it, and a different header aborts it.
	 */
	buildPendingHeader(): Promise<void> {
		if (this.#headerBuild) return this.#headerBuild.promise;
		const plan = this.#pendingHeader;
		this.#pendingHeader = undefined;
		if (!plan || this.#disposed) return Promise.resolve();
		const controller = new AbortController();
		const job: Execution = {
			language: plan.language,
			phase: 'prepare',
			controller,
			signal: controller.signal
		};
		const fs = this.profile.container.fs;
		const path = `/tmp/wasm-idle-stdcpp-${crypto.randomUUID()}.pch`;
		let mutations: ReturnType<Container['fs']['observeMutations']> | undefined;
		try {
			mutations = fs.observeMutations();
		} catch {
			/* A compiled program is then simply rebuilt after this header write. */
		}
		const generation = fs.generation;
		const sources = new Set<unknown>([job]);
		const promise = (async () => {
			let built: Header | undefined;
			try {
				const process = await this.spawn(job, 'clang', [...plan.argv, path], {
					cwd: plan.cwd,
					env: plan.env
				});
				sources.add(process.mutationSource ?? process.pid);
				await process.stdin.getWriter().close();
				const result = await this.drain(process, plan.language, 0, false, true);
				if (this.success(result, job.signal)) {
					const bytes = fs.readFile(path);
					if (bytes.byteLength > 0 && bytes.byteLength <= MAX_HEADER_BYTES)
						built = { key: plan.key, path, bytes, persistentKey: plan.persistentKey };
				}
			} catch {
				/* Without a header the next compile parses it textually. */
			}
			if (built && !controller.signal.aborted && !this.#disposed) {
				this.discardHeader(job);
				this.#header = built;
				if (built.persistentKey)
					void this.headerCache
						.write(built.persistentKey, built.bytes)
						.catch(() => false);
			} else {
				try {
					fs.withMutationSource(job, () => fs.unlink(path));
				} catch {
					/* Never written. */
				}
			}
			// Only this build's own files changed: a compiled program remains current.
			if (mutations && !mutations.hasChangesOutside(sources))
				for (const program of this.#prepared.values())
					if (program.generation === generation) program.generation = fs.generation;
			mutations?.dispose();
			if (this.#headerBuild?.controller === controller) this.#headerBuild = undefined;
		})();
		this.#headerBuild = { key: plan.key, language: plan.language, controller, promise };
		return promise;
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
		if (this.#headerBuild?.language === language)
			this.#headerBuild.controller.abort(new DOMException('Command cancelled', 'AbortError'));
		const job = this.#active.get(language);
		job?.controller.abort(new DOMException('Command cancelled', 'AbortError'));
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
		this.#pendingHeader = undefined;
		this.#headerBuild?.controller.abort(
			new DOMException('Clang runtime disposed', 'AbortError')
		);
		await Promise.allSettled([
			...[...this.#active.keys()].map((language) => this.stop(language)),
			this.#headerBuild?.promise
		]);
		this.discardHeader();
		// Admission can still be settling after cancellation. The container owner will
		// retire that filesystem; never remove an output while a command may use it.
		if (!this.#active.size) {
			const fs = this.profile.container.fs;
			for (const [path, version] of this.#artifactVersions) {
				try {
					if (fs.captureFileVersion(path) === version) fs.unlink(path);
				} catch {
					/* Removed or changed outputs belong to the current filesystem owner. */
				}
			}
			const directory = this.#artifactDirectory;
			if (directory) {
				try {
					if (fs.lstat(directory.path).inode === directory.inode)
						fs.rmdir(directory.path);
				} catch {
					/* Nonrecursive cleanup preserves unexpected files and replaced directories. */
				}
			}
		}
		this.#artifactVersions.clear();
	}
}

export { ContainerClangRuntime as WebsiteClangRuntime };
