import { resolveElixirBundleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

interface PopcornCallSuccess {
	ok: true;
	data: unknown;
	durationMs: number;
}

interface PopcornCallFailure {
	ok: false;
	error: unknown;
	durationMs: number;
}

interface PopcornInstance {
	call(
		args: unknown,
		options?: {
			process?: string;
			timeoutMs?: number;
		}
	): Promise<PopcornCallSuccess | PopcornCallFailure>;
	deinit(): void;
}

interface PopcornStatic {
	init(options: {
		bundlePath: string;
		onStderr?: (message: string) => void;
		onStdout?: (message: string) => void;
		debug?: boolean;
	}): Promise<PopcornInstance>;
}

class Elixir implements Sandbox {
	output: any = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	bundleUrl = '';
	popcorn: PopcornInstance | null = null;
	activeReject: ((reason: string) => void) | null = null;
	prepared = false;
	hasExecuted = false;

	private deinitRuntime() {
		if (!this.popcorn) return;
		try {
			this.popcorn.deinit();
		} catch {
			// Ignore duplicate deinit attempts while resetting the hidden iframe.
		}
		this.popcorn = null;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextBundleUrl = resolveElixirBundleUrl(runtimeAssets, currentUrl);
			if (!nextBundleUrl) {
				return reject(
					'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
				);
			}

			try {
				if (this.popcorn && this.bundleUrl !== nextBundleUrl) {
					this.deinitRuntime();
				}
				if (!this.popcorn) {
					progress?.set?.(0.2);
					const { Popcorn } = (await import('@swmansion/popcorn')) as {
						Popcorn: PopcornStatic;
					};
					progress?.set?.(0.5);
					this.bundleUrl = nextBundleUrl;
					this.popcorn = await Popcorn.init({
						bundlePath: nextBundleUrl,
						onStdout: (message) => {
							this.output?.(message);
						},
						onStderr: (message) => {
							this.output?.(message);
						}
					});
				}
				progress?.set?.(1);
				resolve();
			} catch (error) {
				reject(error instanceof Error ? error.message : String(error));
			}
		});
	}

	write() {}

	eof() {}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>(async (resolve, reject) => {
			if (!this.popcorn) return reject('Elixir runtime not loaded');
			const activeUid = ++this.uid;
			this.activeReject = reject;
			this.begin = Date.now();

			if (prepare) {
				this.prepared = true;
				this.hasExecuted = false;
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.activeReject = null;
				_prog?.set?.(1);
				return resolve(true);
			}

			try {
				const result = await this.popcorn.call(['eval_elixir', code], {
					timeoutMs: 30_000
				});
				if (activeUid !== this.uid) return;
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.activeReject = null;
				this.prepared = false;
				this.hasExecuted = true;

				if (!result.ok) {
					const message =
						result.error instanceof Error
							? result.error.message
							: typeof result.error === 'string'
								? result.error
								: (() => {
										try {
											return JSON.stringify(result.error);
										} catch {
											return String(result.error);
										}
									})();
					return reject(message || 'Elixir evaluation failed');
				}

				const rendered =
					typeof result.data === 'string'
						? result.data
						: result.data === undefined
							? ''
							: (() => {
									try {
										return JSON.stringify(result.data);
									} catch {
										return String(result.data);
									}
								})();
				if (rendered) {
					this.output?.(`=> ${rendered}\n`);
				}
				resolve(rendered || true);
			} catch (error) {
				if (activeUid !== this.uid) return;
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.activeReject = null;
				this.prepared = false;
				this.hasExecuted = false;
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
		this.prepared = false;
		this.hasExecuted = false;
		this.deinitRuntime();
		this.exit = true;
	}

	async clear() {
		if (!this.exit || this.hasExecuted) {
			this.deinitRuntime();
		}
		if (this.hasExecuted) {
			this.prepared = false;
			this.hasExecuted = false;
		}
	}
}

export default Elixir;
