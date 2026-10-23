import type { DebugFrame, DebugScope, DebugVariable } from '@wasm-idle/core';

/** Opaque paths identify a visible source/scope/field path, never a DAP handle. */
export type DebugVariableNode = {
	path: string;
	variable: DebugVariable;
	expression?: string;
	children: DebugVariableNode[];
	expanded: boolean;
	loading: boolean;
	hasMore: boolean;
	changed: boolean;
	previousValue?: string;
};

export type DebugSnapshotVariable = {
	readonly path: string;
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly changed: boolean;
	readonly previousValue?: string;
	readonly expanded: boolean;
	readonly children: readonly DebugSnapshotVariable[];
};

export type DebugStopSnapshot = {
	readonly id: number;
	readonly timestamp: number;
	readonly reason: string | null;
	readonly line: number | null;
	readonly sourcePath: string | null;
	readonly frameKey: string;
	readonly callStack: readonly Readonly<
		Pick<DebugFrame, 'functionName' | 'line' | 'sourcePath'>
	>[];
	readonly variables: readonly DebugSnapshotVariable[];
	readonly watches: readonly {
		readonly expression: string;
		readonly value: string;
		readonly node?: DebugSnapshotVariable;
	}[];
	readonly truncated: boolean;
};

const MAX_TREE_NODES = 5_000;
const MAX_TREE_DEPTH = 64;
const MAX_EXPANDED_PATHS = 512;
const MAX_SNAPSHOT_CHARACTERS = 65_536;

export function isLocalScope(scope: DebugScope) {
	return scope.presentationHint
		? scope.presentationHint === 'locals' || scope.presentationHint === 'arguments'
		: /^(locals|arguments)$/iu.test(scope.name);
}

export function isArgumentScope(scope: DebugScope) {
	return scope.presentationHint
		? scope.presentationHint === 'arguments'
		: /^arguments$/iu.test(scope.name);
}

/** Stable adapter ordering retains innermost precedence among local scopes. */
export function orderDebugScopes(scopes: readonly DebugScope[]) {
	return [...scopes].sort(
		(left, right) =>
			(isLocalScope(left) ? Number(isArgumentScope(left)) : 2) -
			(isLocalScope(right) ? Number(isArgumentScope(right)) : 2)
	);
}

/** Caller locations distinguish recursive activations; the selected location may advance. */
export function debugFramePathKey(
	frames: DebugFrame[],
	frameId: number | null,
	sourcePath: string
) {
	const index = frameId === null ? 0 : frames.findIndex((frame) => frame.id === frameId);
	if (index < 0 || !frames.length || frames.length - index > MAX_TREE_DEPTH) return null;
	const key = JSON.stringify(
		frames
			.slice(index)
			.map((frame, offset) => [
				frame.functionName,
				frame.sourcePath || sourcePath,
				offset === 0 ? null : frame.line
			])
	);
	return key.length <= 4_096 ? key : null;
}

function childExpression(parent: string | undefined, variable: DebugVariable) {
	if (parent === undefined) return undefined;
	if (
		variable.evaluateName &&
		/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[(?:0|[1-9][0-9]*)\]))*$/u.test(
			variable.evaluateName
		)
	)
		return variable.evaluateName;
	if (/^\[(?:0|[1-9][0-9]*)\]$/u.test(variable.name)) return `${parent}${variable.name}`;
	if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable.name))
		return parent ? `${parent}.${variable.name}` : variable.name;
	return undefined;
}

/** Live handles and diff baselines are kept outside the persisted expansion paths. */
export function createDebugVariableState() {
	const expanded = new Set<string>();
	const entries = new Map<string, { node: DebugVariableNode; parentReference?: number }>();
	let previous = new Map<string, string>();
	let current = new Map<string, string>();
	let knownFrameKeys = new Set<string>();
	let comparable = false;

	return {
		beginStop(frameKeys: string[], compare: boolean) {
			previous = compare ? current : new Map();
			current = new Map();
			knownFrameKeys = new Set(frameKeys);
			comparable = compare;
			entries.clear();
		},
		/** Caller pages can complete a stop without replacing its comparison baseline. */
		setFrameKeys(frameKeys: string[]) {
			knownFrameKeys = new Set(frameKeys);
		},
		reset() {
			previous.clear();
			current.clear();
			knownFrameKeys.clear();
			entries.clear();
			comparable = false;
		},
		clearLive() {
			entries.clear();
		},
		setExpanded(path: string, value: boolean) {
			if (!entries.has(path)) return false;
			if (value) {
				expanded.delete(path);
				expanded.add(path);
				if (expanded.size > MAX_EXPANDED_PATHS)
					expanded.delete(expanded.values().next().value!);
			} else expanded.delete(path);
			return true;
		},
		entry(path: string) {
			return entries.get(path);
		},
		build(options: {
			frameKey: string;
			scopes: DebugScope[];
			locals: DebugVariable[];
			variablesByReference: ReadonlyMap<number, DebugVariable[]>;
			loadingReferences: ReadonlySet<number>;
			watches?: { expression: string; variable?: DebugVariable }[];
		}) {
			entries.clear();
			let remaining = MAX_TREE_NODES;
			const buildList = (
				variables: DebugVariable[],
				parentPath: string,
				parentExpression: string | undefined,
				parentReference: number | undefined,
				ancestors: Set<number>,
				depth: number,
				shadowedNames?: ReadonlySet<string>
			): DebugVariableNode[] => {
				const occurrences = new Map<string, number>();
				const counts = new Map<string, number>();
				for (const variable of variables.slice(0, Math.max(0, remaining)))
					counts.set(variable.name, (counts.get(variable.name) ?? 0) + 1);
				const duplicates = new Set(
					[...counts].filter(([, count]) => count > 1).map(([name]) => name)
				);
				const nodes: DebugVariableNode[] = [];
				for (const variable of variables) {
					if (remaining-- <= 0) break;
					const occurrence = occurrences.get(variable.name) ?? 0;
					occurrences.set(variable.name, occurrence + 1);
					const path = `${parentPath}/${JSON.stringify([variable.name, occurrence])}`;
					if (path.length > 8_192) continue;
					const reference = variable.variablesReference ?? 0;
					const children = options.variablesByReference.get(reference);
					const old =
						comparable && knownFrameKeys.has(options.frameKey)
							? previous.get(path)
							: undefined;
					// Partial caller suffixes are not stable identities for the next stop.
					if (knownFrameKeys.has(options.frameKey)) {
						current.set(path, variable.value);
						if (current.size > MAX_TREE_NODES)
							current.delete(current.keys().next().value!);
					}
					const count = (variable.namedVariables ?? 0) + (variable.indexedVariables ?? 0);
					const expression =
						duplicates.has(variable.name) || shadowedNames?.has(variable.name)
							? undefined
							: childExpression(parentExpression, variable);
					const node: DebugVariableNode = {
						path,
						variable,
						expression,
						children: [],
						expanded: expanded.has(path),
						loading: options.loadingReferences.has(reference),
						hasMore:
							reference > 0 && (children === undefined || count > children.length),
						changed: old !== undefined && old !== variable.value,
						...(old !== undefined && old !== variable.value
							? { previousValue: old }
							: {})
					};
					entries.set(path, {
						node,
						parentReference: duplicates.has(variable.name) ? undefined : parentReference
					});
					if (children && depth < MAX_TREE_DEPTH && !ancestors.has(reference)) {
						const nextAncestors = new Set(ancestors).add(reference);
						node.children = buildList(
							children,
							path,
							expression,
							reference,
							nextAncestors,
							depth + 1
						);
					}
					nodes.push(node);
				}
				return nodes;
			};
			const scopes = new Map<number, DebugVariableNode[]>();
			const locals: DebugVariableNode[] = [];
			const seenScopes = new Map<string, number>();
			const shadowedNames = new Set<string>();
			let unresolvedHigherScope = false;
			for (const scope of orderDebugScopes(options.scopes)) {
				const key = JSON.stringify([scope.name, scope.presentationHint ?? '']);
				const occurrence = seenScopes.get(key) ?? 0;
				seenScopes.set(key, occurrence + 1);
				const nodes = buildList(
					options.variablesByReference.get(scope.variablesReference) ?? scope.variables,
					`${options.frameKey}/scope:${key}:${occurrence}`,
					unresolvedHigherScope ? undefined : '',
					scope.variablesReference,
					new Set([scope.variablesReference]),
					0,
					shadowedNames
				);
				for (const node of nodes) shadowedNames.add(node.variable.name);
				if (
					scope.variablesReference > 0 &&
					!options.variablesByReference.has(scope.variablesReference) &&
					!scope.variables.length
				)
					unresolvedHigherScope = true;
				scopes.set(scope.variablesReference, nodes);
				if (isLocalScope(scope)) locals.push(...nodes);
			}
			// Trace and adapters without scope metadata expose locals directly.
			if (!locals.length && options.locals.length)
				locals.push(
					...buildList(
						options.locals,
						`${options.frameKey}/locals`,
						'',
						undefined,
						new Set(),
						0
					)
				);
			const watches = new Map<string, DebugVariableNode>();
			for (const watch of options.watches ?? []) {
				if (!watch.variable) continue;
				const node = buildList(
					[{ ...watch.variable, evaluateName: watch.expression }],
					`${options.frameKey}/watch:${JSON.stringify(watch.expression)}`,
					'',
					undefined,
					new Set(),
					0
				)[0];
				if (node) watches.set(watch.expression, node);
			}
			return { locals, scopes, watches };
		}
	};
}

/** Copy only rendered data. No protocol handles survive in a historical snapshot. */
export function createDebugStopSnapshot(
	metadata: Omit<DebugStopSnapshot, 'variables' | 'watches' | 'callStack' | 'truncated'>,
	frames: DebugFrame[],
	nodes: DebugVariableNode[],
	watches: { expression: string; value: string; node?: DebugVariableNode }[],
	nodeLimit: number
): DebugStopSnapshot {
	let remaining = nodeLimit;
	let characters = MAX_SNAPSHOT_CHARACTERS;
	let truncated = false;
	const copyText = (value: string, max = 512) => {
		const limit = Math.min(max, Math.max(0, characters));
		const result = value.slice(0, limit);
		characters -= result.length;
		if (result.length !== value.length) truncated = true;
		return result;
	};
	const copyNodes = (values: DebugVariableNode[]): readonly DebugSnapshotVariable[] => {
		const result: DebugSnapshotVariable[] = [];
		for (const node of values) {
			if (remaining <= 0 || characters <= 0) {
				truncated = true;
				break;
			}
			remaining -= 1;
			result.push(
				Object.freeze({
					path: copyText(node.path, 8_192),
					name: copyText(node.variable.name, 128),
					value: copyText(node.variable.value),
					...(node.variable.type === undefined
						? {}
						: { type: copyText(node.variable.type, 128) }),
					changed: node.changed,
					...(node.previousValue === undefined
						? {}
						: { previousValue: copyText(node.previousValue) }),
					expanded: node.expanded,
					children: copyNodes(node.children)
				})
			);
		}
		return Object.freeze(result);
	};
	const boundedMetadata = {
		...metadata,
		frameKey: copyText(metadata.frameKey, 4_096),
		sourcePath: metadata.sourcePath === null ? null : copyText(metadata.sourcePath, 1_024),
		reason: metadata.reason === null ? null : copyText(metadata.reason, 128)
	};
	const callStack = Object.freeze(
		frames.slice(0, 64).map((frame) =>
			Object.freeze({
				functionName: copyText(frame.functionName, 128),
				line: frame.line,
				...(frame.sourcePath ? { sourcePath: copyText(frame.sourcePath, 256) } : {})
			})
		)
	);
	const variables = copyNodes(nodes);
	const watchValues = Object.freeze(
		watches.slice(0, 64).map((watch) =>
			Object.freeze({
				expression: copyText(watch.expression),
				value: copyText(watch.value),
				...(watch.node ? { node: copyNodes([watch.node])[0] } : {})
			})
		)
	);
	return Object.freeze({
		...boundedMetadata,
		variables,
		watches: watchValues,
		callStack,
		truncated
	});
}
