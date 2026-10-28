import type { DebugVariable } from '@wasm-idle/core';
import type { LldbSandboxSession } from './lldbSession';

type Backend = Pick<LldbSandboxSession, 'variables' | 'readMemory'>;
type Children = { fields: DebugVariable[]; bytes?: { address: number; length: number } };
type Budget = { requests: number; epoch: number };

const MAX_REFERENCES = 256;
const MAX_REQUESTS = 64;
const MAX_DEPTH = 4;
const PREVIEW_BYTES = 32;
const PAGE_SIZE = 64;
const WASM32_END = 0x1_0000_0000;

const addressOf = (value: string) => {
	// LLDB's memoryReference on a pointer names its storage, not its pointee.
	const match = /^(0x[\da-f]{1,8})(?:\s|$)/i.exec(value);
	return match ? Number.parseInt(match[1], 16) : undefined;
};
const addressText = (address: number) => `0x${address.toString(16)}`;
const shortValue = (value: string) => (value.length > 160 ? `${value.slice(0, 160)}…` : value);
const isUnavailable = (variable: DebugVariable) =>
	variable.value === '?' || variable.value.startsWith('<');

function bytePreview(bytes: Uint8Array, truncated: boolean) {
	let text: string;
	try {
		// Streaming avoids replacing an incomplete UTF-8 character at the preview boundary.
		text = JSON.stringify(
			new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated })
		);
	} catch {
		text = '"';
		for (const byte of bytes) {
			text +=
				byte >= 32 && byte < 127
					? byte === 34 || byte === 92
						? `\\${String.fromCharCode(byte)}`
						: String.fromCharCode(byte)
					: `\\x${byte.toString(16).padStart(2, '0')}`;
		}
		text += '"';
	}
	return text + (truncated ? '…' : '');
}

/** Pinned Zig DWARF layouts only. No expressions or user code are evaluated. */
export class ZigDebugValues {
	private epoch = 0;
	private readonly children = new Map<number, Children>();
	private readonly layouts = new Map<number, DebugVariable>();

	constructor(private readonly backend: Backend) {}

	invalidate() {
		this.layouts.clear();
		this.invalidateValues();
	}

	/** A memory write preserves DAP handles in this stop, but not their values. */
	invalidateValues() {
		this.epoch += 1;
		this.children.clear();
	}

	async variables(reference: number, start?: number, count?: number): Promise<DebugVariable[]> {
		if (!Number.isSafeInteger(reference) || reference <= 0)
			throw new RangeError('variablesReference must be a positive safe integer.');
		for (const [name, value] of [
			['start', start],
			['count', count]
		] as const) {
			if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
				throw new RangeError(`${name} must be a non-negative safe integer.`);
		}
		const budget = { requests: MAX_REQUESTS, epoch: this.epoch };
		const children = this.children.get(reference);
		if (children) return this.expand(children, start ?? 0, count ?? PAGE_SIZE, budget);
		const layout = this.layouts.get(reference);
		if (layout) {
			// Re-read the original native fields/tag/range before applying UI child paging.
			// Paging the native ptr/len fields as byte indices would silently lose pages.
			await this.format(layout, budget, 0);
			const refreshed = this.children.get(reference);
			return refreshed && budget.epoch === this.epoch
				? this.expand(refreshed, start ?? 0, count ?? PAGE_SIZE, budget)
				: [];
		}
		const values = await this.backend.variables(reference, start, count);
		const result: DebugVariable[] = [];
		for (const value of values) {
			if (budget.epoch !== this.epoch) return [];
			result.push(await this.format(value, budget, 0));
		}
		return budget.epoch === this.epoch ? result : [];
	}

	private describe(variable: DebugVariable, value: string, children: Children): DebugVariable {
		const reference = variable.variablesReference!;
		if (this.layouts.size >= MAX_REFERENCES && !this.layouts.has(reference)) return variable;
		this.layouts.set(reference, variable);
		this.children.set(reference, children);
		const indexedVariables = children.bytes?.length ?? 0;
		return {
			...variable,
			value,
			variablesReference: children.fields.length || indexedVariables ? reference : 0,
			namedVariables: children.fields.length,
			indexedVariables
		};
	}

	private async format(
		variable: DebugVariable,
		budget: Budget,
		depth: number
	): Promise<DebugVariable> {
		const type = variable.type ?? '';
		const reference = variable.variablesReference;
		if (
			isUnavailable(variable) ||
			type.length > 1024 ||
			depth >= MAX_DEPTH ||
			budget.requests <= 0 ||
			budget.epoch !== this.epoch ||
			(this.layouts.size >= MAX_REFERENCES && !this.layouts.has(reference ?? 0))
		)
			return variable;
		if (type.startsWith('?*')) {
			const address = addressOf(variable.value);
			if (address === undefined) return variable;
			if (address !== 0) return { ...variable, value: `some(${shortValue(variable.value)})` };
			return {
				...variable,
				value: 'null',
				variablesReference: 0,
				namedVariables: 0,
				indexedVariables: 0
			};
		}
		if (!reference) return variable;
		const slice = /^(\?)?\[\](?:const )?(.+)$/.exec(type);
		const optional = type.startsWith('?');
		const errorUnion = /^(?:error\{[^{}\r\n]*\}|anyerror)!(.+)$/.exec(type);
		if (!slice && !optional && !errorUnion) return variable;
		budget.requests -= 1;
		let fields: DebugVariable[];
		try {
			// Two members in each supported layout; a third member rejects lookalike layouts.
			fields = await this.backend.variables(reference, 0, 3);
		} catch {
			return variable;
		}
		if (budget.epoch !== this.epoch) return variable;
		const field = (name: string) => fields.find((entry) => entry.name === name);
		const payload = field('payload');
		if (slice) {
			const pointer = field('ptr');
			const length = field('len');
			if (fields.length !== 2 || !pointer || !length) return variable;
			const address = addressOf(pointer.value);
			if (slice[1] && address === 0) return this.describe(variable, 'null', { fields: [] });
			const size = /^\d{1,10}$/.test(length.value) ? Number(length.value) : NaN;
			if (address === undefined || !Number.isInteger(size) || size > 0xffff_ffff)
				return variable;
			const metadata = { fields: [pointer, length] };
			if (slice[2] === 'u8' && ((address === 0 && size > 0) || address + size > WASM32_END))
				return this.describe(variable, '<unavailable: invalid slice range>', metadata);
			let value = `len=${size}, ptr=${addressText(address)}`;
			let bytes: Children['bytes'];
			if (slice[2] === 'u8') {
				const preview =
					size === 0
						? new Uint8Array()
						: await this.readBytes(address, Math.min(size, PREVIEW_BYTES), budget);
				if (budget.epoch !== this.epoch) return variable;
				if (preview) {
					value = `len=${size} ${bytePreview(preview, size > preview.length)}`;
					bytes = { address, length: size };
				} else value += ' <preview unavailable>';
			}
			return this.describe(variable, slice[1] ? `some(${value})` : value, {
				...metadata,
				bytes
			});
		}
		if (optional) {
			const some = field('some');
			if (fields.length !== 2 || !payload || !some) return variable;
			if (['0', "'\\0'", "'\\x00'"].includes(some.value))
				return this.describe(variable, 'null', { fields: [] });
			if (!['1', "'\\x01'"].includes(some.value))
				return this.describe(variable, '<unavailable: invalid optional tag>', {
					fields: []
				});
			const value = await this.format(payload, budget, depth + 1);
			if (budget.epoch !== this.epoch) return variable;
			return this.describe(variable, `some(${shortValue(value.value)})`, { fields: [value] });
		}
		const error = field('error');
		const voidPayload = errorUnion![1] === 'void';
		if (!error || fields.length !== (voidPayload ? 1 : 2) || (!voidPayload && !payload))
			return variable;
		if (error.value === 'null') {
			if (voidPayload) return this.describe(variable, '{}', { fields: [] });
			const value = await this.format(payload!, budget, depth + 1);
			if (budget.epoch !== this.epoch) return variable;
			return this.describe(variable, shortValue(value.value), { fields: [value] });
		}
		return this.describe(
			variable,
			error.value.startsWith('error.')
				? shortValue(error.value)
				: '<unavailable: invalid error tag>',
			{ fields: [error] }
		);
	}

	private async readBytes(address: number, count: number, budget: Budget) {
		if (budget.requests <= 0 || budget.epoch !== this.epoch) return null;
		budget.requests -= 1;
		try {
			const memory = await this.backend.readMemory(addressText(address), 0, count);
			return budget.epoch === this.epoch &&
				memory?.data.length === count &&
				!memory.unreadableBytes
				? memory.data
				: null;
		} catch {
			return null;
		}
	}

	private async expand(children: Children, start: number, count: number, budget: Budget) {
		// Named metadata precedes byte indices, matching the debugger tree's paging contract.
		const end = start + Math.min(count, PAGE_SIZE);
		const values = children.fields.slice(start, end);
		const bytes = children.bytes;
		if (bytes) {
			const first = Math.max(0, start - children.fields.length);
			const last = Math.min(bytes.length, end - children.fields.length);
			if (last > first) {
				const memory = await this.readBytes(bytes.address + first, last - first, budget);
				for (let index = first; index < last; index += 1)
					values.push({
						name: `[${index}]`,
						value: memory ? String(memory[index - first]) : '<unavailable>',
						type: 'u8',
						variablesReference: 0,
						memoryReference: addressText(bytes.address + index)
					});
			}
		}
		return budget.epoch === this.epoch ? values : [];
	}
}
