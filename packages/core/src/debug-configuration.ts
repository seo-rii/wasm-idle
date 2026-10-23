import type { DebugSourceBreakpoint, DebugSteppingOptions } from './debug.js';

/** Copy configuration before asynchronous dispatch, bounding untrusted host input. */
export function normalizeDebugSourceBreakpoints(values: readonly DebugSourceBreakpoint[]) {
	if (!Array.isArray(values)) throw new TypeError('breakpoints must be an array.');
	if (values.length > 1024) throw new RangeError('breakpoints must not exceed 1024 entries.');
	return values.map((value, index): DebugSourceBreakpoint => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError(`breakpoints[${index}] must be an object.`);
		}
		if (!Number.isSafeInteger(value.line) || value.line < 1) {
			throw new RangeError('Breakpoint lines must be positive safe integers.');
		}
		if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
			throw new TypeError(`breakpoints[${index}].enabled must be boolean.`);
		}
		const copy: DebugSourceBreakpoint = { line: value.line };
		if (value.enabled !== undefined) copy.enabled = value.enabled;
		for (const key of ['condition', 'hitCondition', 'logMessage'] as const) {
			const text = value[key];
			if (text === undefined) continue;
			if (typeof text !== 'string')
				throw new TypeError(`breakpoints[${index}].${key} must be a string.`);
			if (text.length > 4096)
				throw new RangeError(
					`breakpoints[${index}].${key} must not exceed 4096 UTF-16 code units.`
				);
			if (text.includes('\0'))
				throw new TypeError(`breakpoints[${index}].${key} must not contain NUL.`);
			if (
				key === 'hitCondition' &&
				text &&
				(!/^[1-9][0-9]*$/u.test(text) || Number(text) > 0xffffffff)
			) {
				throw new RangeError(
					'hitCondition must be a positive decimal count not exceeding 4294967295.'
				);
			}
			copy[key] = text;
		}
		return copy;
	});
}

export function assertDebugBreakpointSupport(
	values: readonly DebugSourceBreakpoint[],
	support: {
		conditionalBreakpoints?: boolean;
		hitConditionalBreakpoints?: boolean;
		logPoints?: boolean;
	}
) {
	for (const value of values) {
		if (value.enabled === false) continue;
		for (const [field, capability] of [
			['condition', 'conditionalBreakpoints'],
			['hitCondition', 'hitConditionalBreakpoints'],
			['logMessage', 'logPoints']
		] as const) {
			if (value[field] && support[capability] !== true) {
				throw new Error(`Debugger does not support breakpoint ${field}.`);
			}
		}
	}
}

export function normalizeDebugSteppingOptions(value: DebugSteppingOptions): DebugSteppingOptions {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => key !== 'skipLibraryCode') ||
		typeof value.skipLibraryCode !== 'boolean'
	) {
		throw new TypeError(
			'stepping options must contain only the boolean skipLibraryCode policy.'
		);
	}
	return { skipLibraryCode: value.skipLibraryCode };
}

/** Legacy replacement retains options only for explicitly requested locations. */
export function mergeDebugBreakpointLines(
	values: readonly DebugSourceBreakpoint[],
	lines: readonly number[]
) {
	if (!Array.isArray(lines) || lines.some((line) => !Number.isSafeInteger(line) || line < 1))
		throw new RangeError('Breakpoint lines must be positive safe integers.');
	const specifications = normalizeDebugSourceBreakpoints(values);
	return normalizeDebugSourceBreakpoints(
		lines.map((line) => {
			const existing = specifications.find((value) => value.line === line);
			return existing ? { ...existing, enabled: true } : { line };
		})
	);
}
