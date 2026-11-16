import { limitC3WasmMemory } from './c3Memory.js';

// Reuse the memory-section validator without changing C3's embedded classic-worker source.
/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {number} maximumBytes
 * @param {{runtimeLabel?: string}} [options]
 */
export async function limitWasmMemory(bytes, maximumBytes, { runtimeLabel = 'Interpreter' } = {}) {
	try {
		return await limitC3WasmMemory(bytes, maximumBytes);
	} catch (error) {
		if (error instanceof Error) error.message = error.message.replace(/\bC3\b/gu, runtimeLabel);
		throw error;
	}
}
