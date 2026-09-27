/** One speculative runtime at a time. Execution owns a runtime after take(). */
export interface PrewarmResource {
	dispose?: () => void | Promise<void>;
	terminate: () => void | Promise<void>;
}

export interface PrewarmEnvironment {
	/** Return a cancellation function. The callback must not run synchronously. */
	schedule: (callback: () => void) => () => void;
	canStart: () => boolean;
}

export function browserPrewarmEnvironment(): PrewarmEnvironment {
	return {
		canStart() {
			if (typeof window === 'undefined' || typeof document === 'undefined') return false;
			const connection = (navigator as Navigator & {
				connection?: { saveData?: boolean; effectiveType?: string };
			}).connection;
			return document.visibilityState !== 'hidden' && connection?.saveData !== true &&
				!['slow-2g', '2g'].includes(connection?.effectiveType ?? '');
		},
		schedule(callback) {
			if (typeof window.requestIdleCallback === 'function') {
				const id = window.requestIdleCallback(callback, { timeout: 1500 });
				return () => window.cancelIdleCallback(id);
			}
			const id = setTimeout(callback, 250);
			return () => clearTimeout(id);
		}
	};
}

interface Slot<T> {
	key: string;
	controller: AbortController;
	cancelSchedule: () => void;
	start: () => void;
	result: Promise<T | undefined>;
	taken: boolean;
	started: boolean;
}

/** Speculative failures resolve to undefined; foreground loading can retry normally. */
export function createRuntimePrewarmer<T extends PrewarmResource>(
	create: (key: string, signal: AbortSignal) => Promise<T>,
	options: { enabled?: boolean; environment?: PrewarmEnvironment; release?: (resource: T) => void | Promise<void> } = {}
) {
	let enabled = options.enabled === true;
	let disposed = false;
	let slot: Slot<T> | undefined;
	const environment = options.environment ?? browserPrewarmEnvironment();
	const pending = new Set<Promise<unknown>>();
	const release = async (resource: T) => {
		if (options.release) await options.release(resource);
		else if (resource.dispose) await resource.dispose();
		else await resource.terminate();
	};
	const cancel = () => {
		const previous = slot;
		slot = undefined;
		if (!previous) return Promise.resolve();
		previous.cancelSchedule();
		previous.controller.abort(new DOMException('Runtime prewarm cancelled', 'AbortError'));
		// Settle a scheduled slot without invoking the loader.
		previous.start();
		const cleanup = previous.result.then(async (resource) => {
			if (resource) await release(resource);
		});
		pending.add(cleanup);
		void cleanup.finally(() => pending.delete(cleanup)).catch(() => {});
		return cleanup;
	};
	return {
		get enabled() { return enabled; },
		async setEnabled(value: boolean) {
			if (typeof value !== 'boolean') throw new TypeError('prewarm must be a boolean');
			enabled = value;
			if (!enabled) await cancel();
		},
		warm(key: string): Promise<boolean> {
			if (disposed || !enabled || !environment.canStart()) return Promise.resolve(false);
			if (slot?.key === key) {
				const current = slot;
				return current.result.then((resource) =>
					Boolean(resource && !current.controller.signal.aborted && (current.taken || slot === current))
				);
			}
			const predecessor = cancel().catch(() => {});
			const controller = new AbortController();
			let resolve!: (resource: T | undefined) => void;
			const result = new Promise<T | undefined>((done) => { resolve = done; });
			const next: Slot<T> = {
				key, controller, result, taken: false, started: false, cancelSchedule: () => {},
				start() {
					if (next.started) return;
					next.started = true;
					next.cancelSchedule();
					void predecessor.then(() => {
						if (controller.signal.aborted || disposed || (!next.taken && !environment.canStart())) {
							resolve(undefined);
							return;
						}
						// The factory must clean up a partially-created resource on rejection.
						void Promise.resolve().then(() => create(key, controller.signal)).then(resolve, () => resolve(undefined));
					});
				}
			};
			slot = next;
			next.cancelSchedule = environment.schedule(next.start);
			void result.then((resource) => {
				if (!resource && slot === next) slot = undefined;
			});
			return result.then((resource) =>
				Boolean(resource && !controller.signal.aborted && (next.taken || slot === next))
			);
		},
		take(key: string): Promise<T | undefined> | undefined {
			const current = slot;
			if (!current || disposed) return undefined;
			if (current.key !== key) {
				void cancel().catch(() => {});
				return undefined;
			}
			// Detach before awaiting, so disabling prewarm never cancels a foreground run.
			slot = undefined;
			current.taken = true;
			current.start();
			return current.result;
		},
		cancel,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await cancel();
			await Promise.allSettled([...pending]);
		}
	};
}
