import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

type BashRuntimeAssetConfig = PlaygroundRuntimeAssets & {
	bash?: { webcUrl?: string };
};

type WasmerSdk = typeof import('@wasmer/sdk');
type WasmerPackage = Awaited<ReturnType<WasmerSdk['Wasmer']['fromFile']>>;
type WasixInstance = Awaited<ReturnType<NonNullable<WasmerPackage['entrypoint']>['run']>>;

let sdkPromise: Promise<WasmerSdk> | undefined;

class Bash implements Sandbox {
	output?: (data: string) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	webcUrl = '';
	runtimePackage: WasmerPackage | null = null;
	instance: WasixInstance | null = null;
	stdinWriter: WritableStreamDefaultWriter | null = null;
	pendingInput: string[] = [];
	pendingEof = false;
	activeReject: ((reason: string) => void) | null = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?:
			| { set?: (value: number, stage?: string) => void }
			| import('svelte/store').Writable<number>
	) {
		this.pendingInput = [];
		this.pendingEof = false;
		const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
		const configured = (runtimeAssets as BashRuntimeAssetConfig)?.bash?.webcUrl;
		const rootUrl =
			typeof runtimeAssets === 'string'
				? runtimeAssets
				: (runtimeAssets as BashRuntimeAssetConfig)?.rootUrl || '';
		const normalizedRoot = rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
		const nextWebcUrl = configured || `${normalizedRoot}/wasm-bash/bash.webc`;
		this.webcUrl = currentUrl ? new URL(nextWebcUrl, currentUrl).href : nextWebcUrl;

		progress?.set?.(0.1, 'Loading Bash runtime');
		if (!sdkPromise) {
			sdkPromise = import('@wasmer/sdk').then(async (sdk) => {
				await sdk.init();
				return sdk;
			});
		}
		const [response, sdk] = await Promise.all([fetch(this.webcUrl), sdkPromise]);
		if (!response.ok) {
			throw new Error(`Failed to load Bash WEBc package: HTTP ${response.status}`);
		}
		this.runtimePackage?.free();
		this.runtimePackage = await sdk.Wasmer.fromFile(
			new Uint8Array(await response.arrayBuffer())
		);
		progress?.set?.(1, 'Bash runtime ready');
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		void this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		void this.flushPendingInput();
	}

	private async flushPendingInput() {
		if (!this.stdinWriter) return;
		const pending = this.pendingInput.splice(0);
		for (const input of pending) {
			await this.stdinWriter.write(new TextEncoder().encode(input));
		}
		if (this.pendingEof) {
			this.pendingEof = false;
			await this.stdinWriter.close();
			this.stdinWriter = null;
		}
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?:
			| { set?: (value: number, stage?: string) => void }
			| import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (prepare) return true;
		if (!this.runtimePackage) throw new Error('Bash runtime is not loaded');

		this.exit = false;
		this.begin = Date.now();
		const runUid = ++this.uid;
		const { programArgs } = resolveSandboxExecutionArgs('BASH', args, options);
		const activePath = options.activePath || 'main.sh';
		const mountedFiles: Record<string, string> = {};
		for (const file of options.workspaceFiles || []) {
			const path = file.path.replace(/^\/+/, '');
			if (!path || path.split('/').includes('..')) {
				throw new Error(`Invalid Bash workspace path: ${file.path}`);
			}
			mountedFiles[path] = file.content;
		}
		const mountedActivePath = activePath.replace(/^\/+/, '');
		if (!mountedActivePath || mountedActivePath.split('/').includes('..')) {
			throw new Error(`Invalid Bash active path: ${activePath}`);
		}
		mountedFiles[mountedActivePath] = code;
		const queuedStdin = this.pendingInput.length > 0 ? this.pendingInput.join('') : undefined;
		const suppliedStdin = options.stdin ?? (this.pendingEof ? queuedStdin || '' : undefined);
		if (suppliedStdin !== undefined) {
			this.pendingInput = [];
			this.pendingEof = false;
		}

		return new Promise<boolean | string>(async (resolve, reject) => {
			this.activeReject = reject;
			try {
				const command = this.runtimePackage?.entrypoint;
				if (!command) throw new Error('Bash WEBc package has no entrypoint');
				const instance = await command.run({
					args: ['-c', code, mountedActivePath, ...programArgs],
					mount: { '/workspace': mountedFiles },
					cwd: '/workspace',
					...(suppliedStdin === undefined ? {} : { stdin: suppliedStdin })
				});
				if (runUid !== this.uid) {
					instance.free();
					return;
				}
				this.instance = instance;
				this.stdinWriter = instance.stdin?.getWriter() || null;
				await this.flushPendingInput();

				const stdoutDone = instance.stdout.pipeTo(
					new WritableStream({
						write: (chunk) => {
							if (runUid === this.uid) {
								this.output?.(new TextDecoder().decode(chunk));
							}
						}
					})
				);
				const stderrDone = instance.stderr.pipeTo(
					new WritableStream({
						write: (chunk) => {
							if (runUid === this.uid) {
								this.output?.(new TextDecoder().decode(chunk));
							}
						}
					})
				);
				const result = await instance.wait();
				await Promise.allSettled([stdoutDone, stderrDone]);
				if (runUid !== this.uid) return;

				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.activeReject = null;
				this.stdinWriter = null;
				this.instance = null;
				instance.free();
				if (!result.ok) {
					reject(`Bash exited with status ${result.code}.`);
					return;
				}
				resolve(true);
			} catch (error) {
				if (runUid !== this.uid) return;
				this.exit = true;
				this.activeReject = null;
				this.stdinWriter = null;
				this.instance = null;
				reject(error instanceof Error ? error.message : String(error));
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.uid += 1;
		void this.stdinWriter?.abort('Process terminated').catch(() => {});
		this.stdinWriter = null;
		this.instance?.free();
		this.instance = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.runtimePackage?.free();
		this.runtimePackage = null;
	}
}

export default Bash;
