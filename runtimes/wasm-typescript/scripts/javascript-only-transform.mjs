// Only the self-contained JavaScript entry aliases SWC to this guard. The full
// TypeScript bundle continues to use the real pinned SWC implementation.
export function transformSync() {
	throw new Error('TypeScript source requires the full TypeScript runtime, not javascript.js.');
}
