import type {
	CommandDefinition,
	HostCommandInvocation,
	LiveCommandAdapter,
	MemoryFileSystem
} from '@wasm-idle/container';

export const SHELL_CONTROL_COMMAND = 'wasm-idle-shell-control';
export const SHELL_CONTROL_FUNCTION_ENV = 'BASH_FUNC___wasm_idle_poll%%';
export const SHELL_CONTROL_ROUTE = `/usr/local/bin/${SHELL_CONTROL_COMMAND}`;
export const SHELL_CONTROL_MOUNT = '/usr/share/wasm-idle-shell-control';
export const SHELL_CONTROL_RCFILE = `${SHELL_CONTROL_MOUNT}/rcfile`;
export const SHELL_CONTROL_REQUEST = '/tmp/.wasm-idle-shell-control-request';
const SHELL_INPUTRC = '/tmp/.wasm-idle-shell-inputrc';
const ADAPTER = 'website-shell-control-v1';
const MAX_GENERATION = 2147483647;
const encoder = new TextEncoder();

export interface ShellControlInspection {
	readonly ready: boolean;
	readonly disposed: boolean;
	/** Last cwd confirmed by the actual shell host invocation, or the host's initial cwd. */
	readonly cwd: string;
	readonly pendingCwd: string | null;
	readonly generation: number;
	readonly appliedGeneration: number;
	readonly error: string | null;
}

export interface ShellControlOptions {
	languages: readonly string[];
	initialDirectory?: string;
	onChange?: (inspection: ShellControlInspection) => void;
	/** Trusted deterministic protocol fixture input; never read from guest messages. */
	session?: string;
}

interface PendingControl {
	version: '1' | '2';
	target: string;
	cwd?: string;
	promise: Promise<void>;
	resolve(): void;
	reject(error: Error): void;
	removeAbort?(): void;
}

const abortError = (message: string) => new DOMException(message, 'AbortError');
const canonicalDirectory = (path: string) =>
	path.length <= 4096 &&
	path.startsWith('/') &&
	!path.includes('\0') &&
	(path === '/' ||
		path
			.slice(1)
			.split('/')
			.every((part) => part && part !== '.' && part !== '..'));

function rcfile(session: string, languages: readonly string[]) {
	return [
		'# Trusted application rcfile. The mailbox is data and is never evaluated.',
		'__wasm_idle_poll() {',
		'  local __wic_version __wic_session __wic_generation __wic_language __wic_extra __wic_oldpwd __wic_fd',
		`  local __wic_expected_session='${session}'`,
		// WASIX dup2 restoration loses stdin's polling rights. Read through a fresh
		// descriptor instead of temporarily replacing the live terminal's fd 0.
		`  [[ -f '${SHELL_CONTROL_REQUEST}' && -r '${SHELL_CONTROL_REQUEST}' ]] || return 0`,
		`  if builtin exec {__wic_fd}< '${SHELL_CONTROL_REQUEST}'; then :; else return 0; fi`,
		'  if IFS=\' \' builtin read -r -n 160 -u "$__wic_fd" __wic_version __wic_session __wic_generation __wic_language __wic_extra; then',
		'    builtin exec {__wic_fd}<&-',
		'  else',
		'    builtin exec {__wic_fd}<&-',
		'    return 0',
		'  fi',
		'  [[ "$__wic_session" == "$__wic_expected_session" && -z "$__wic_extra" ]] || return 0',
		'  [[ "$__wic_generation" =~ ^[1-9][0-9]{0,9}$ ]] || return 0',
		`  (( __wic_generation <= ${MAX_GENERATION} && __wic_generation > \${__wasm_idle_control_generation:-0} )) || return 0`,
		'  if [[ "$__wic_version" == 2 ]]; then',
		'    case "$__wic_language" in suspend|resume) ;; *) return 0 ;; esac',
		'    __wasm_idle_control_generation=$__wic_generation',
		// Output belongs to the actual shell, while its editing buffer remains untouched.
		'    builtin printf "\\r\\n"',
		`    if '${SHELL_CONTROL_ROUTE}' 2 "$__wic_session" "$__wic_generation" "$__wic_language" ok; then :; else :; fi`,
		// The pinned native hook decodes PS1 and redraws the preserved Readline buffer.
		'    [[ "$__wic_language" == resume ]] && return 124',
		'    return 0',
		'  fi',
		'  [[ "$__wic_version" == 1 ]] || return 0',
		`  case "$__wic_language" in ${languages.join('|')}) ;; *) return 0 ;; esac`,
		'  __wasm_idle_control_generation=$__wic_generation',
		'  __wic_oldpwd=$PWD',
		'  if builtin cd -P -- "/workspace/$__wic_language"; then',
		`    if '${SHELL_CONTROL_ROUTE}' 1 "$__wic_session" "$__wic_generation" "$__wic_language" ok; then :; else :; fi`,
		'    if [[ "$__wic_oldpwd" != "$PWD" ]]; then',
		'      builtin printf "\\r\\n"',
		'      return 124',
		'    fi',
		'  else',
		`    if '${SHELL_CONTROL_ROUTE}' 1 "$__wic_session" "$__wic_generation" "$__wic_language" failed; then :; else :; fi`,
		'  fi',
		'  return 0',
		'}',
		// The native primary Readline hook preserves both $? and PIPESTATUS.
		// A PROMPT_COMMAND wrapper cannot restore PIPESTATUS and must not own polling.
		'readonly -f __wasm_idle_poll',
		''
	].join('\n');
}

/** Host directory requests are read only at the producer's real primary-prompt boundary. */
export function createShellControl(options: ShellControlOptions) {
	const languages = [...new Set(options.languages)].sort();
	if (!languages.length || languages.some((language) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(language)))
		throw new Error('Shell control requires a fixed language allowlist');
	const allowed = new Set(languages);
	const session =
		options.session ??
		Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
			byte.toString(16).padStart(2, '0')
		).join('');
	if (!/^[a-f0-9]{32}$/.test(session)) throw new Error('Invalid shell control session');
	let cwd = options.initialDirectory ?? '/workspace';
	if (cwd !== '/workspace' && !languages.some((language) => cwd === `/workspace/${language}`))
		throw new Error('Invalid initial shell directory');
	let filesystem: MemoryFileSystem | undefined,
		disposed = false,
		generation = 0,
		appliedGeneration = 0;
	let pending: PendingControl | undefined,
		error: string | null = null;
	let lastAcknowledgement:
		| { version: string; generation: number; target: string; cwd: string; verdict: string }
		| undefined;
	const inspect = (): ShellControlInspection =>
		Object.freeze({
			ready: Boolean(filesystem),
			disposed,
			cwd,
			pendingCwd: pending?.cwd ?? null,
			generation,
			appliedGeneration,
			error
		});
	const changed = () => {
		try {
			options.onChange?.(inspect());
		} catch {
			/* Observers do not own protocol state. */
		}
	};
	const currentFilesystem = () => {
		if (disposed) throw new Error('Shell directory control has been disposed');
		if (!filesystem) throw new Error('Shell directory control has not been set up');
		return filesystem;
	};
	const ensureDirectory = (fs: MemoryFileSystem, path: string) => {
		if (
			fs.lstat('/workspace').type !== 'directory' ||
			fs.realpath('/workspace') !== '/workspace'
		)
			throw new Error('Workspace root is not a directory');
		try {
			if (fs.lstat(path).type !== 'directory' || fs.realpath(path) !== path)
				throw new Error('Shell directory must be an actual project directory');
		} catch (reason) {
			if ((reason as { code?: string }).code !== 'ENOENT') throw reason;
			fs.mkdir(path);
		}
	};
	const writeRequest = (fs: MemoryFileSystem, value: string) => {
		if (fs.lstat('/tmp').type !== 'directory' || fs.realpath('/tmp') !== '/tmp')
			throw new Error('Shell control needs the private temporary mount');
		try {
			if (fs.lstat(SHELL_CONTROL_REQUEST).type !== 'file')
				throw new Error('Shell control mailbox must be a regular file');
		} catch (reason) {
			if ((reason as { code?: string }).code !== 'ENOENT') throw reason;
		}
		fs.writeFile(SHELL_CONTROL_REQUEST, encoder.encode(value), { mode: 0o600 });
	};
	const acknowledge = (args: readonly string[], actualCwd: string) => {
		if (
			disposed ||
			!filesystem ||
			args.length !== 5 ||
			!['1', '2'].includes(args[0]) ||
			args[1] !== session ||
			!/^[1-9][0-9]{0,9}$/.test(args[2]) ||
			!(args[0] === '1' ? allowed.has(args[3]) : ['suspend', 'resume'].includes(args[3])) ||
			!['ok', 'failed'].includes(args[4]) ||
			!canonicalDirectory(actualCwd)
		)
			return 126;
		const version = args[0],
			received = Number(args[2]),
			target = args[3],
			verdict = args[4];
		if (version === '1' && verdict === 'ok' && actualCwd !== `/workspace/${target}`) return 126;
		if (received > MAX_GENERATION || received > generation) return 126;
		if (received < generation) return 0; // A superseded completion cannot publish the new request.
		if (!pending)
			return lastAcknowledgement?.version === version &&
				lastAcknowledgement.generation === received &&
				lastAcknowledgement.target === target &&
				lastAcknowledgement.cwd === actualCwd &&
				lastAcknowledgement.verdict === verdict
				? 0
				: 126;
		if (
			pending.version !== version ||
			pending.target !== target ||
			(pending.cwd && verdict === 'ok' && actualCwd !== pending.cwd)
		)
			return 126;
		const completed = pending;
		pending = undefined;
		completed.removeAbort?.();
		cwd = actualCwd;
		lastAcknowledgement = { version, generation: received, target, cwd: actualCwd, verdict };
		if (verdict === 'ok') {
			appliedGeneration = received;
			error = null;
			completed.resolve();
		} else {
			error = `Bash could not enter ${completed.cwd}`;
			completed.reject(new Error(error));
		}
		changed();
		return 0;
	};
	const request = (version: '1' | '2', target: string, signal?: AbortSignal): Promise<void> => {
		try {
			const fs = currentFilesystem();
			signal?.throwIfAborted();
			if (version === '1' ? !allowed.has(target) : !['suspend', 'resume'].includes(target))
				throw new Error('Unknown shell control target');
			if (pending?.version === version && pending.target === target) return pending.promise;
			if (generation === MAX_GENERATION)
				throw new Error('Shell control generation exhausted');
			const targetCwd = version === '1' ? `/workspace/${target}` : undefined,
				nextGeneration = generation + 1;
			if (targetCwd) ensureDirectory(fs, targetCwd);
			writeRequest(fs, `${version} ${session} ${nextGeneration} ${target}\n`);
			pending?.removeAbort?.();
			pending?.reject(abortError('Shell control request was superseded'));
			let resolve!: () => void, reject!: (reason: Error) => void;
			const promise = new Promise<void>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			const next: PendingControl = {
				version,
				target,
				cwd: targetCwd,
				promise,
				resolve,
				reject
			};
			pending = next;
			generation = nextGeneration;
			error = null;
			if (signal) {
				const abort = () => {
					if (pending !== next) return;
					pending = undefined;
					next.removeAbort?.();
					// A foreground command must not receive control on its eventual return.
					try {
						writeRequest(fs, `1 ${session} 0 -\n`);
					} catch {
						/* Preserve the cancellation if the guest has removed its mailbox. */
					}
					reject(signal.reason ?? abortError('Shell control request was cancelled'));
					changed();
				};
				signal.addEventListener('abort', abort, { once: true });
				next.removeAbort = () => signal.removeEventListener('abort', abort);
			}
			changed();
			return promise;
		} catch (reason) {
			return Promise.reject(reason);
		}
	};
	const adapter: LiveCommandAdapter = {
		id: ADAPTER,
		filesystem: 'live',
		async start(request) {
			if (
				request.fs !== currentFilesystem() ||
				request.invocation.command !== SHELL_CONTROL_COMMAND
			)
				throw new Error('Shell control command belongs to a different container');
			const emptyOutput = () =>
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.close();
					}
				});
			return {
				stdin: new WritableStream<Uint8Array>({
					write(bytes) {
						if (bytes.length)
							throw new Error('Shell control does not consume program input');
					}
				}),
				stdout: emptyOutput(),
				stderr: emptyOutput(),
				async run() {
					return {
						code: request.signal.aborted
							? 143
							: acknowledge(request.invocation.args, request.invocation.cwd)
					};
				},
				async dispose() {}
			};
		}
	};
	const commands: Readonly<Record<string, CommandDefinition>> = Object.freeze({
		[SHELL_CONTROL_COMMAND]: Object.freeze({
			adapter: ADAPTER,
			bytes: new Uint8Array(),
			argv0: SHELL_CONTROL_COMMAND
		})
	});
	const configuration = Object.freeze({
		mountPath: SHELL_CONTROL_MOUNT,
		rcfilePath: SHELL_CONTROL_RCFILE,
		requestPath: SHELL_CONTROL_REQUEST,
		// The pinned WASIX host requests inherited write access even for O_RDONLY.
		// Standard Bash function import bootstraps the trusted body without opening
		// a readonly file; the opt-in producer makes this one imported function readonly.
		args: Object.freeze(['--noprofile', '--norc', '-i']),
		env: Object.freeze({
			WASM_IDLE_SHELL_CONTROL: '1',
			INPUTRC: SHELL_INPUTRC,
			[SHELL_CONTROL_FUNCTION_ENV]: `() ${rcfile(session, languages).match(/__wasm_idle_poll\(\) (\{[\s\S]*?\n\})/)![1]}`
		})
	});
	return Object.freeze({
		adapter,
		commands,
		route: Object.freeze({ path: SHELL_CONTROL_ROUTE, command: SHELL_CONTROL_COMMAND }),
		setup(fs: MemoryFileSystem) {
			if (disposed) throw new Error('Shell directory control has been disposed');
			if (filesystem) {
				if (filesystem !== fs) throw new Error('Shell control cannot share containers');
				return configuration;
			}
			ensureDirectory(fs, cwd);
			writeRequest(fs, `1 ${session} 0 -\n`);
			// The pinned C locale otherwise interprets UTF-8 input as Meta keys.
			// Keep this on the writable mount: WASIX overrequests rights on open.
			fs.writeFile(
				SHELL_INPUTRC,
				encoder.encode('set input-meta on\nset convert-meta off\nset output-meta on\n'),
				{ mode: 0o600 }
			);
			fs.mountReadonly(SHELL_CONTROL_MOUNT, [
				{
					path: 'rcfile',
					type: 'file',
					mode: 0o444,
					data: encoder.encode(rcfile(session, languages))
				}
			]);
			filesystem = fs;
			changed();
			return configuration;
		},
		requestDirectory(language: string): Promise<void> {
			if (!allowed.has(language))
				return Promise.reject(new Error('Unknown shell project directory'));
			return request('1', language);
		},
		requestPrompt(action: 'suspend' | 'resume', signal?: AbortSignal): Promise<void> {
			return request('2', action, signal);
		},
		onInvocation(invocation: HostCommandInvocation): number | undefined {
			return invocation.path === SHELL_CONTROL_ROUTE
				? acknowledge(invocation.argv.slice(1), invocation.cwd)
				: undefined;
		},
		inspect,
		dispose() {
			if (disposed) return;
			disposed = true;
			pending?.removeAbort?.();
			pending?.reject(abortError('Shell directory control was disposed'));
			pending = undefined;
			if (filesystem) {
				try {
					if (
						filesystem.lstat(SHELL_CONTROL_REQUEST).type === 'file' &&
						new TextDecoder()
							.decode(filesystem.readFile(SHELL_CONTROL_REQUEST))
							.startsWith(`1 ${session} `)
					)
						filesystem.unlink(SHELL_CONTROL_REQUEST);
				} catch {
					/* The guest may already have removed the temporary mailbox. */
				}
			}
			changed();
		}
	});
}
