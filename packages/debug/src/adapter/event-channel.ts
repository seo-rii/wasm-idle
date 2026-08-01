import type { DebugAdapterEvent } from './types.js';

export function createDebugAdapterEventChannel() {
	const listeners = new Set<(event: DebugAdapterEvent) => void>();

	return {
		emit(event: DebugAdapterEvent) {
			let firstError: unknown;
			let listenerFailed = false;
			for (const listener of [...listeners]) {
				if (!listeners.has(listener)) continue;
				try {
					listener(event);
				} catch (error) {
					if (listenerFailed) continue;
					firstError = error;
					listenerFailed = true;
				}
			}
			if (listenerFailed) throw firstError;
		},
		subscribe(listener: (event: DebugAdapterEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
