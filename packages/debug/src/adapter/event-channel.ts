import type { DebugAdapterEvent } from './types.js';

export function createDebugAdapterEventChannel() {
	const listeners = new Set<(event: DebugAdapterEvent) => void>();

	return {
		emit(event: DebugAdapterEvent) {
			for (const listener of [...listeners]) listener(event);
		},
		subscribe(listener: (event: DebugAdapterEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
