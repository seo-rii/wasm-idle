import type { DebugSource } from './types.js';

export function cloneDebugSource(source: DebugSource): DebugSource {
	return { ...source };
}

export function debugSourceKey(source: DebugSource) {
	if (source.path) return `path:${source.path}`;
	if (source.sourceReference !== undefined) return `reference:${source.sourceReference}`;
	if (source.name) return `name:${source.name}`;
	return 'anonymous';
}

export function sameDebugSource(left: DebugSource, right: DebugSource) {
	if (left.path !== undefined || right.path !== undefined) {
		return left.path !== undefined && left.path === right.path;
	}
	if (left.sourceReference !== undefined || right.sourceReference !== undefined) {
		return left.sourceReference !== undefined && left.sourceReference === right.sourceReference;
	}
	if (left.name !== undefined || right.name !== undefined) {
		return left.name !== undefined && left.name === right.name;
	}
	return false;
}

export function validateBreakpointLines(lines: number[]) {
	for (const line of lines) {
		if (!Number.isInteger(line) || line < 1) {
			throw new RangeError(`Breakpoint lines must be positive integers; received ${line}.`);
		}
	}
	return [...lines];
}
