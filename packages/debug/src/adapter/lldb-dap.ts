import type {
	DapCapabilities,
	DapEvent,
	DapInitializeRequestArguments,
	DapSession
} from './dap.js';
import { createDebugAdapterEventChannel } from './event-channel.js';
import { cloneDebugSource, debugSourceKey, validateBreakpointLines } from './source.js';
import {
	DebugAdapterProtocolError,
	DebugAdapterStateError,
	UnsupportedDebugOperationError,
	type DebugAdapter,
	type DebugAdapterEvent,
	type DebugCapabilities,
	type DebugDisconnectOptions,
	type DebugEvaluateResult,
	type DebugLaunchConfig,
	type DebugMemory,
	type DebugScope,
	type DebugSource,
	type DebugStackFrame,
	type DebugThread,
	type DebugVariable,
	type DebugVariablePresentationHint,
	type ResolvedBreakpoint
} from './types.js';

export interface LldbDapAdapterOptions {
	initializeArguments?: Partial<DapInitializeRequestArguments>;
	featureSupport?: {
		/**
		 * WebAssembly expression evaluation is not assumed merely because a DAP
		 * transport exists. Set this only when the linked LLDB build supports it.
		 */
		evaluate?: boolean;
	};
}

const defaultInitializeArguments: DapInitializeRequestArguments = {
	clientID: 'wasm-idle',
	clientName: 'wasm-idle',
	adapterID: 'lldb-web-dap',
	linesStartAt1: true,
	columnsStartAt1: true,
	pathFormat: 'path',
	supportsVariableType: true,
	supportsVariablePaging: true,
	supportsRunInTerminalRequest: false,
	supportsMemoryReferences: true,
	supportsProgressReporting: false,
	supportsInvalidatedEvent: false,
	supportsMemoryEvent: false
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function invalidDapResponse(command: string, path: string, expectation: string): never {
	throw new DebugAdapterProtocolError(command, path, expectation);
}

function assertDapRecord(
	value: unknown,
	command: string,
	path: string
): asserts value is Record<string, unknown> {
	if (!isObject(value) || Array.isArray(value)) {
		invalidDapResponse(command, path, 'expected an object');
	}
}

function assertDapString(value: unknown, command: string, path: string): asserts value is string {
	if (typeof value !== 'string') {
		invalidDapResponse(command, path, 'expected a string');
	}
}

function assertDapBoolean(value: unknown, command: string, path: string): asserts value is boolean {
	if (typeof value !== 'boolean') {
		invalidDapResponse(command, path, 'expected a boolean');
	}
}

function assertDapPositiveSafeInteger(
	value: unknown,
	command: string,
	path: string
): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		invalidDapResponse(command, path, 'expected a positive safe integer');
	}
}

function assertDapSafeInteger(
	value: unknown,
	command: string,
	path: string
): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		invalidDapResponse(command, path, 'expected a safe integer');
	}
}

function assertDapNonNegativeSafeInteger(
	value: unknown,
	command: string,
	path: string
): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		invalidDapResponse(command, path, 'expected a non-negative safe integer');
	}
}

function assertDapStringEnum<const TValue extends string>(
	value: unknown,
	values: readonly TValue[],
	command: string,
	path: string
): asserts value is TValue {
	if (typeof value !== 'string' || !values.includes(value as TValue)) {
		invalidDapResponse(command, path, `expected one of ${values.join(', ')}`);
	}
}

function dapPropertyPath(path: string, field: string) {
	return path ? `${path}.${field}` : field;
}

function dapOptionalString(
	record: Record<string, unknown>,
	field: string,
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapString(value, command, dapPropertyPath(path, field));
	return value;
}

function dapOptionalBoolean(
	record: Record<string, unknown>,
	field: string,
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapBoolean(value, command, dapPropertyPath(path, field));
	return value;
}

function dapOptionalNonNegativeSafeInteger(
	record: Record<string, unknown>,
	field: string,
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapNonNegativeSafeInteger(value, command, dapPropertyPath(path, field));
	return value;
}

function dapOptionalPositiveSafeInteger(
	record: Record<string, unknown>,
	field: string,
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapPositiveSafeInteger(value, command, dapPropertyPath(path, field));
	return value;
}

function dapOptionalSafeInteger(
	record: Record<string, unknown>,
	field: string,
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapSafeInteger(value, command, dapPropertyPath(path, field));
	return value;
}

function dapOptionalStringEnum<const TValue extends string>(
	record: Record<string, unknown>,
	field: string,
	values: readonly TValue[],
	command: string,
	path: string
) {
	const value = record[field];
	if (value === undefined) return undefined;
	assertDapStringEnum(value, values, command, dapPropertyPath(path, field));
	return value;
}

function dapResponseCollection(response: unknown, command: string, path: string): unknown[] {
	assertDapRecord(response, command, 'body');
	const collection = response[path];
	if (!Array.isArray(collection)) {
		invalidDapResponse(command, path, 'expected an array');
	}
	return collection;
}

function normalizeDapSource(value: unknown, command: string, path: string): DebugSource {
	assertDapRecord(value, command, path);
	const name = dapOptionalString(value, 'name', command, path);
	const sourcePath = dapOptionalString(value, 'path', command, path);
	const origin = dapOptionalString(value, 'origin', command, path);
	const sourceReference = dapOptionalNonNegativeSafeInteger(
		value,
		'sourceReference',
		command,
		path
	);
	const presentationHint = dapOptionalStringEnum(
		value,
		'presentationHint',
		['normal', 'emphasize', 'deemphasize'],
		command,
		path
	);
	return {
		...(name === undefined ? {} : { name }),
		...(sourcePath === undefined ? {} : { path: sourcePath }),
		...(sourceReference === undefined ? {} : { sourceReference }),
		...(presentationHint === undefined ? {} : { presentationHint }),
		...(origin === undefined ? {} : { origin }),
		...(value.adapterData === undefined ? {} : { adapterData: value.adapterData })
	};
}

function normalizeDapVariablePresentationHint(
	value: unknown,
	command: string,
	path: string
): DebugVariablePresentationHint {
	assertDapRecord(value, command, path);
	const kind = dapOptionalString(value, 'kind', command, path);
	const visibility = dapOptionalString(value, 'visibility', command, path);
	let attributes: string[] | undefined;
	if (value.attributes !== undefined) {
		if (!Array.isArray(value.attributes)) {
			invalidDapResponse(command, `${path}.attributes`, 'expected an array');
		}
		attributes = value.attributes.map((attribute, attributeIndex) => {
			assertDapString(attribute, command, `${path}.attributes[${attributeIndex}]`);
			return attribute;
		});
	}
	const lazy = dapOptionalBoolean(value, 'lazy', command, path);
	return {
		...(kind === undefined ? {} : { kind: kind as DebugVariablePresentationHint['kind'] }),
		...(attributes === undefined
			? {}
			: { attributes: attributes as DebugVariablePresentationHint['attributes'] }),
		...(visibility === undefined
			? {}
			: { visibility: visibility as DebugVariablePresentationHint['visibility'] }),
		...(lazy === undefined ? {} : { lazy })
	};
}

function assertPositiveInteger(value: number, name: string) {
	if (!Number.isInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive integer.`);
	}
}

function assertNonNegativeInteger(value: number, name: string) {
	if (!Number.isInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative integer.`);
	}
}

function cloneResolvedBreakpoints(breakpoints: readonly ResolvedBreakpoint[]) {
	return breakpoints.map((breakpoint) => ({
		...breakpoint,
		source: cloneDebugSource(breakpoint.source)
	}));
}

function mapCapabilities(
	capabilities: DapCapabilities,
	options: LldbDapAdapterOptions
): DebugCapabilities {
	const supportsEvaluate = options.featureSupport?.evaluate === true;

	return Object.freeze({
		supportsConfigurationDone: capabilities.supportsConfigurationDoneRequest === true,
		supportsBreakpoints: true,
		supportsConditionalBreakpoints: false,
		supportsLogPoints: false,
		supportsContinue: true,
		supportsPause: true,
		supportsStepIn: true,
		supportsStepOver: true,
		supportsStepOut: true,
		supportsThreads: true,
		supportsStackTrace: true,
		supportsScopes: true,
		supportsVariables: true,
		supportsEvaluate,
		supportsEvaluateForHovers:
			supportsEvaluate && capabilities.supportsEvaluateForHovers === true,
		supportsReadMemory: capabilities.supportsReadMemoryRequest === true,
		supportsDataBreakpoints: false,
		supportsSetVariable: false,
		supportsRestart: false,
		supportsTerminate: false
	});
}

export class LldbDapAdapter implements DebugAdapter {
	readonly kind = 'lldb' as const;

	readonly #session: DapSession;
	readonly #options: LldbDapAdapterOptions;
	readonly #events = createDebugAdapterEventChannel();
	readonly #breakpointsById = new Map<number, ResolvedBreakpoint>();
	readonly #breakpointsBySource = new Map<string, ResolvedBreakpoint[]>();
	readonly #breakpointIdsBySource = new Map<string, Set<number>>();
	readonly #breakpointRequestVersions = new Map<string, number>();
	#capabilities: DebugCapabilities | null = null;
	#initializeRequest: Promise<DebugCapabilities> | null = null;

	constructor(session: DapSession, options: LldbDapAdapterOptions = {}) {
		this.#session = session;
		this.#options = options;
		session.onEvent((event) => {
			this.#handleDapEvent(event);
		});
	}

	get capabilities() {
		return this.#capabilities;
	}

	initialize() {
		if (this.#capabilities) return Promise.resolve(this.#capabilities);
		if (this.#initializeRequest) return this.#initializeRequest;

		const options: LldbDapAdapterOptions = {
			...this.#options,
			...(this.#options.initializeArguments
				? { initializeArguments: { ...this.#options.initializeArguments } }
				: {}),
			...(this.#options.featureSupport
				? { featureSupport: { ...this.#options.featureSupport } }
				: {})
		};
		const initializeArguments = {
			...defaultInitializeArguments,
			...options.initializeArguments
		};
		this.#initializeRequest = this.#session
			.request<DapCapabilities>('initialize', initializeArguments)
			.then((capabilities) => {
				this.#capabilities = mapCapabilities(capabilities || {}, options);
				return this.#capabilities;
			})
			.catch((error: unknown) => {
				this.#initializeRequest = null;
				throw error;
			});
		return this.#initializeRequest;
	}

	async launch(config: DebugLaunchConfig) {
		this.#requireInitialized();
		await this.#session.request('launch', { ...config });
	}

	async disconnect(options: DebugDisconnectOptions = {}) {
		this.#requireInitialized();
		await this.#session.request('disconnect', {
			terminateDebuggee: options.terminateTarget === true
		});
	}

	async setBreakpoints(source: DebugSource, lines: number[]) {
		this.#requireInitialized();
		const requestedLines = validateBreakpointLines(lines);
		const requestSource = cloneDebugSource(source);
		const sourceKey = debugSourceKey(requestSource);
		const requestVersion = (this.#breakpointRequestVersions.get(sourceKey) ?? 0) + 1;
		this.#breakpointRequestVersions.set(sourceKey, requestVersion);
		let response: unknown;
		try {
			response = await this.#session.request<unknown>('setBreakpoints', {
				source: requestSource,
				breakpoints: requestedLines.map((line) => ({ line })),
				lines: requestedLines
			});
		} catch (error) {
			if (this.#breakpointRequestVersions.get(sourceKey) !== requestVersion) {
				return cloneResolvedBreakpoints(this.#breakpointsBySource.get(sourceKey) ?? []);
			}
			throw error;
		}
		if (this.#breakpointRequestVersions.get(sourceKey) !== requestVersion) {
			return cloneResolvedBreakpoints(this.#breakpointsBySource.get(sourceKey) ?? []);
		}
		const dapBreakpoints = dapResponseCollection(response, 'setBreakpoints', 'breakpoints');
		const resolved = requestedLines.map((requestedLine, index) =>
			this.#normalizeBreakpoint(
				dapBreakpoints[index],
				requestSource,
				requestedLine,
				'setBreakpoints',
				`breakpoints[${index}]`
			)
		);
		if (this.#breakpointRequestVersions.get(sourceKey) === requestVersion) {
			this.#replaceTrackedBreakpoints(requestSource, resolved);
		}
		return cloneResolvedBreakpoints(this.#breakpointsBySource.get(sourceKey) ?? []);
	}

	async continue(threadId: number) {
		await this.#threadRequest('continue', threadId);
	}

	async pause(threadId: number) {
		await this.#threadRequest('pause', threadId);
	}

	async next(threadId: number) {
		await this.#threadRequest('next', threadId);
	}

	async stepIn(threadId: number) {
		await this.#threadRequest('stepIn', threadId);
	}

	async stepOut(threadId: number) {
		await this.#threadRequest('stepOut', threadId);
	}

	async threads() {
		this.#requireInitialized();
		const response = await this.#session.request<unknown>('threads');
		return dapResponseCollection(response, 'threads', 'threads').map<DebugThread>(
			(thread, index) => {
				const path = `threads[${index}]`;
				assertDapRecord(thread, 'threads', path);
				assertDapPositiveSafeInteger(thread.id, 'threads', `${path}.id`);
				assertDapString(thread.name, 'threads', `${path}.name`);
				return { id: thread.id, name: thread.name };
			}
		);
	}

	async stackTrace(threadId: number, startFrame?: number, levels?: number) {
		this.#requireInitialized();
		assertPositiveInteger(threadId, 'threadId');
		if (startFrame !== undefined) assertNonNegativeInteger(startFrame, 'startFrame');
		if (levels !== undefined) assertNonNegativeInteger(levels, 'levels');

		const response = await this.#session.request<unknown>('stackTrace', {
			threadId,
			...(startFrame === undefined ? {} : { startFrame }),
			...(levels === undefined ? {} : { levels })
		});
		return dapResponseCollection(response, 'stackTrace', 'stackFrames').map<DebugStackFrame>(
			(frame, index) => {
				const path = `stackFrames[${index}]`;
				assertDapRecord(frame, 'stackTrace', path);
				assertDapPositiveSafeInteger(frame.id, 'stackTrace', `${path}.id`);
				assertDapString(frame.name, 'stackTrace', `${path}.name`);
				assertDapNonNegativeSafeInteger(frame.line, 'stackTrace', `${path}.line`);
				assertDapNonNegativeSafeInteger(frame.column, 'stackTrace', `${path}.column`);
				const source =
					frame.source === undefined
						? undefined
						: normalizeDapSource(frame.source, 'stackTrace', `${path}.source`);
				const endLine = dapOptionalNonNegativeSafeInteger(
					frame,
					'endLine',
					'stackTrace',
					path
				);
				const endColumn = dapOptionalNonNegativeSafeInteger(
					frame,
					'endColumn',
					'stackTrace',
					path
				);
				const canRestart = dapOptionalBoolean(frame, 'canRestart', 'stackTrace', path);
				const instructionPointerReference = dapOptionalString(
					frame,
					'instructionPointerReference',
					'stackTrace',
					path
				);
				const moduleId = frame.moduleId;
				if (
					moduleId !== undefined &&
					typeof moduleId !== 'string' &&
					!Number.isSafeInteger(moduleId)
				) {
					invalidDapResponse(
						'stackTrace',
						`${path}.moduleId`,
						'expected a string or safe integer'
					);
				}
				const presentationHint = dapOptionalStringEnum(
					frame,
					'presentationHint',
					['normal', 'label', 'subtle'],
					'stackTrace',
					path
				);
				return {
					id: frame.id,
					name: frame.name,
					...(source === undefined ? {} : { source }),
					line: frame.line,
					column: frame.column,
					...(endLine === undefined ? {} : { endLine }),
					...(endColumn === undefined ? {} : { endColumn }),
					...(canRestart === undefined ? {} : { canRestart }),
					...(instructionPointerReference === undefined
						? {}
						: { instructionPointerReference }),
					...(moduleId === undefined ? {} : { moduleId: moduleId as number | string }),
					...(presentationHint === undefined ? {} : { presentationHint })
				};
			}
		);
	}

	async scopes(frameId: number) {
		this.#requireInitialized();
		assertPositiveInteger(frameId, 'frameId');
		const response = await this.#session.request<unknown>('scopes', { frameId });
		return dapResponseCollection(response, 'scopes', 'scopes').map<DebugScope>(
			(scope, index) => {
				const path = `scopes[${index}]`;
				assertDapRecord(scope, 'scopes', path);
				assertDapString(scope.name, 'scopes', `${path}.name`);
				assertDapNonNegativeSafeInteger(
					scope.variablesReference,
					'scopes',
					`${path}.variablesReference`
				);
				assertDapBoolean(scope.expensive, 'scopes', `${path}.expensive`);
				const presentationHint = dapOptionalString(
					scope,
					'presentationHint',
					'scopes',
					path
				);
				const namedVariables = dapOptionalNonNegativeSafeInteger(
					scope,
					'namedVariables',
					'scopes',
					path
				);
				const indexedVariables = dapOptionalNonNegativeSafeInteger(
					scope,
					'indexedVariables',
					'scopes',
					path
				);
				const source =
					scope.source === undefined
						? undefined
						: normalizeDapSource(scope.source, 'scopes', `${path}.source`);
				const line = dapOptionalNonNegativeSafeInteger(scope, 'line', 'scopes', path);
				const column = dapOptionalNonNegativeSafeInteger(scope, 'column', 'scopes', path);
				const endLine = dapOptionalNonNegativeSafeInteger(scope, 'endLine', 'scopes', path);
				const endColumn = dapOptionalNonNegativeSafeInteger(
					scope,
					'endColumn',
					'scopes',
					path
				);
				return {
					name: scope.name,
					...(presentationHint === undefined
						? {}
						: { presentationHint: presentationHint as DebugScope['presentationHint'] }),
					variablesReference: scope.variablesReference,
					...(namedVariables === undefined ? {} : { namedVariables }),
					...(indexedVariables === undefined ? {} : { indexedVariables }),
					expensive: scope.expensive,
					...(source === undefined ? {} : { source }),
					...(line === undefined ? {} : { line }),
					...(column === undefined ? {} : { column }),
					...(endLine === undefined ? {} : { endLine }),
					...(endColumn === undefined ? {} : { endColumn })
				};
			}
		);
	}

	async variables(variablesReference: number, start?: number, count?: number) {
		this.#requireInitialized();
		assertPositiveInteger(variablesReference, 'variablesReference');
		if (start !== undefined) assertNonNegativeInteger(start, 'start');
		if (count !== undefined) assertNonNegativeInteger(count, 'count');

		const response = await this.#session.request<unknown>('variables', {
			variablesReference,
			...(start === undefined ? {} : { start }),
			...(count === undefined ? {} : { count })
		});
		return dapResponseCollection(response, 'variables', 'variables').map<DebugVariable>(
			(variable, index) => {
				const path = `variables[${index}]`;
				assertDapRecord(variable, 'variables', path);
				assertDapString(variable.name, 'variables', `${path}.name`);
				assertDapString(variable.value, 'variables', `${path}.value`);
				assertDapNonNegativeSafeInteger(
					variable.variablesReference,
					'variables',
					`${path}.variablesReference`
				);
				const variableType = dapOptionalString(variable, 'type', 'variables', path);
				const evaluateName = dapOptionalString(variable, 'evaluateName', 'variables', path);
				const memoryReference = dapOptionalString(
					variable,
					'memoryReference',
					'variables',
					path
				);
				const namedVariables = dapOptionalNonNegativeSafeInteger(
					variable,
					'namedVariables',
					'variables',
					path
				);
				const indexedVariables = dapOptionalNonNegativeSafeInteger(
					variable,
					'indexedVariables',
					'variables',
					path
				);
				const presentationHint =
					variable.presentationHint === undefined
						? undefined
						: normalizeDapVariablePresentationHint(
								variable.presentationHint,
								'variables',
								`${path}.presentationHint`
							);
				return {
					name: variable.name,
					value: variable.value,
					...(variableType === undefined ? {} : { type: variableType }),
					...(presentationHint === undefined ? {} : { presentationHint }),
					...(evaluateName === undefined ? {} : { evaluateName }),
					variablesReference: variable.variablesReference,
					...(namedVariables === undefined ? {} : { namedVariables }),
					...(indexedVariables === undefined ? {} : { indexedVariables }),
					...(memoryReference === undefined ? {} : { memoryReference })
				};
			}
		);
	}

	async readMemory(memoryReference: string, offset: number, count: number) {
		this.#requireCapability('supportsReadMemory', 'read memory');
		if (!Number.isInteger(offset)) throw new RangeError('offset must be an integer.');
		assertNonNegativeInteger(count, 'count');

		const response = await this.#session.request<unknown>('readMemory', {
			memoryReference,
			offset,
			count
		});
		assertDapRecord(response, 'readMemory', 'body');
		assertDapString(response.address, 'readMemory', 'address');
		const encodedData = dapOptionalString(response, 'data', 'readMemory', '');
		const unreadableBytes =
			dapOptionalNonNegativeSafeInteger(response, 'unreadableBytes', 'readMemory', '') ?? 0;
		let data = new Uint8Array();
		if (encodedData !== undefined) {
			let binary: string;
			try {
				binary = globalThis.atob(encodedData);
			} catch {
				invalidDapResponse('readMemory', 'data', 'expected valid Base64');
			}
			if (binary.length > count) {
				invalidDapResponse(
					'readMemory',
					'data',
					`decoded ${binary.length} bytes for a ${count}-byte request`
				);
			}
			if (binary.length + unreadableBytes > count) {
				invalidDapResponse(
					'readMemory',
					'unreadableBytes',
					`reported ${binary.length} readable and ${unreadableBytes} unreadable bytes for a ${count}-byte request`
				);
			}
			data = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				data[index] = binary.charCodeAt(index);
			}
		}
		return {
			address: response.address,
			data,
			unreadableBytes
		} satisfies DebugMemory;
	}

	async evaluate(expression: string, frameId?: number) {
		this.#requireCapability('supportsEvaluate', 'evaluate expressions');
		if (frameId !== undefined) assertPositiveInteger(frameId, 'frameId');
		const response = await this.#session.request<unknown>('evaluate', {
			expression,
			context: 'watch',
			...(frameId === undefined ? {} : { frameId })
		});
		assertDapRecord(response, 'evaluate', 'body');
		assertDapString(response.result, 'evaluate', 'result');
		assertDapNonNegativeSafeInteger(
			response.variablesReference,
			'evaluate',
			'variablesReference'
		);
		const resultType = dapOptionalString(response, 'type', 'evaluate', '');
		const namedVariables = dapOptionalNonNegativeSafeInteger(
			response,
			'namedVariables',
			'evaluate',
			''
		);
		const indexedVariables = dapOptionalNonNegativeSafeInteger(
			response,
			'indexedVariables',
			'evaluate',
			''
		);
		const memoryReference = dapOptionalString(response, 'memoryReference', 'evaluate', '');
		const presentationHint =
			response.presentationHint === undefined
				? undefined
				: normalizeDapVariablePresentationHint(
						response.presentationHint,
						'evaluate',
						'presentationHint'
					);
		return {
			result: response.result,
			...(resultType === undefined ? {} : { type: resultType }),
			...(presentationHint === undefined ? {} : { presentationHint }),
			variablesReference: response.variablesReference,
			...(namedVariables === undefined ? {} : { namedVariables }),
			...(indexedVariables === undefined ? {} : { indexedVariables }),
			...(memoryReference === undefined ? {} : { memoryReference })
		} satisfies DebugEvaluateResult;
	}

	onEvent(listener: (event: DebugAdapterEvent) => void) {
		return this.#events.subscribe(listener);
	}

	async #threadRequest(command: string, threadId: number) {
		this.#requireInitialized();
		assertPositiveInteger(threadId, 'threadId');
		await this.#session.request(command, { threadId });
	}

	#requireInitialized() {
		if (!this.#capabilities) {
			throw new DebugAdapterStateError('The LLDB DAP adapter has not been initialized.');
		}
		return this.#capabilities;
	}

	#requireCapability(capability: 'supportsEvaluate' | 'supportsReadMemory', operation: string) {
		const capabilities = this.#requireInitialized();
		if (!capabilities[capability]) throw new UnsupportedDebugOperationError(operation);
	}

	#normalizeBreakpoint(
		breakpoint: unknown,
		fallbackSource: DebugSource,
		requestedLine: number,
		command: string,
		path: string
	): ResolvedBreakpoint {
		if (breakpoint === undefined) {
			return {
				verified: false,
				source: cloneDebugSource(fallbackSource),
				requestedLine,
				line: requestedLine
			};
		}
		assertDapRecord(breakpoint, command, path);
		assertDapBoolean(breakpoint.verified, command, `${path}.verified`);
		const id = dapOptionalPositiveSafeInteger(breakpoint, 'id', command, path);
		const source =
			breakpoint.source === undefined
				? cloneDebugSource(fallbackSource)
				: normalizeDapSource(breakpoint.source, command, `${path}.source`);
		const line = dapOptionalNonNegativeSafeInteger(breakpoint, 'line', command, path);
		const column = dapOptionalNonNegativeSafeInteger(breakpoint, 'column', command, path);
		const endLine = dapOptionalNonNegativeSafeInteger(breakpoint, 'endLine', command, path);
		const endColumn = dapOptionalNonNegativeSafeInteger(breakpoint, 'endColumn', command, path);
		const message = dapOptionalString(breakpoint, 'message', command, path);
		const instructionReference = dapOptionalString(
			breakpoint,
			'instructionReference',
			command,
			path
		);
		const offset = dapOptionalSafeInteger(breakpoint, 'offset', command, path);
		return {
			...(id === undefined ? {} : { id }),
			verified: breakpoint.verified,
			source,
			requestedLine,
			line: line && line > 0 ? line : requestedLine,
			...(column === undefined ? {} : { column }),
			...(endLine === undefined ? {} : { endLine }),
			...(endColumn === undefined ? {} : { endColumn }),
			...(message === undefined ? {} : { message }),
			...(instructionReference === undefined ? {} : { instructionReference }),
			...(offset === undefined ? {} : { offset })
		};
	}

	#replaceTrackedBreakpoints(source: DebugSource, breakpoints: ResolvedBreakpoint[]) {
		const sourceKey = debugSourceKey(source);
		for (const id of this.#breakpointIdsBySource.get(sourceKey) || []) {
			this.#breakpointsById.delete(id);
		}

		const snapshot = cloneResolvedBreakpoints(breakpoints);
		this.#breakpointsBySource.set(sourceKey, snapshot);
		const ids = new Set<number>();
		for (const breakpoint of snapshot) {
			if (breakpoint.id === undefined) continue;
			ids.add(breakpoint.id);
			this.#breakpointsById.set(breakpoint.id, breakpoint);
		}
		this.#breakpointIdsBySource.set(sourceKey, ids);
	}

	#handleDapEvent(event: DapEvent) {
		let mapped: DebugAdapterEvent | null;
		try {
			mapped = this.#mapDapEvent(event);
		} catch (error) {
			if (!(error instanceof DebugAdapterProtocolError)) throw error;
			mapped = { type: 'dap', event: event.event, body: event.body };
		}
		if (mapped) this.#events.emit(mapped);
	}

	#mapDapEvent(event: DapEvent): DebugAdapterEvent | null {
		if (event.event === 'initialized') return { type: 'initialized' };

		if (event.event === 'stopped') {
			const body = event.body;
			assertDapRecord(body, 'event:stopped', 'body');
			assertDapString(body.reason, 'event:stopped', 'reason');
			const description = dapOptionalString(body, 'description', 'event:stopped', '');
			const threadId = dapOptionalPositiveSafeInteger(body, 'threadId', 'event:stopped', '');
			const preserveFocusHint = dapOptionalBoolean(
				body,
				'preserveFocusHint',
				'event:stopped',
				''
			);
			const text = dapOptionalString(body, 'text', 'event:stopped', '');
			const allThreadsStopped = dapOptionalBoolean(
				body,
				'allThreadsStopped',
				'event:stopped',
				''
			);
			let hitBreakpointIds: number[] | undefined;
			if (body.hitBreakpointIds !== undefined) {
				if (!Array.isArray(body.hitBreakpointIds)) {
					invalidDapResponse('event:stopped', 'hitBreakpointIds', 'expected an array');
				}
				hitBreakpointIds = body.hitBreakpointIds.map((id, index) => {
					assertDapPositiveSafeInteger(id, 'event:stopped', `hitBreakpointIds[${index}]`);
					return id;
				});
			}
			return {
				type: 'stopped',
				reason: body.reason,
				...(description === undefined ? {} : { description }),
				...(threadId === undefined ? {} : { threadId }),
				...(preserveFocusHint === undefined ? {} : { preserveFocusHint }),
				...(text === undefined ? {} : { text }),
				...(allThreadsStopped === undefined ? {} : { allThreadsStopped }),
				...(hitBreakpointIds === undefined ? {} : { hitBreakpointIds })
			};
		}

		if (event.event === 'continued') {
			const body = event.body;
			assertDapRecord(body, 'event:continued', 'body');
			assertDapPositiveSafeInteger(body.threadId, 'event:continued', 'threadId');
			const allThreadsContinued = dapOptionalBoolean(
				body,
				'allThreadsContinued',
				'event:continued',
				''
			);
			return {
				type: 'continued',
				threadId: body.threadId,
				...(allThreadsContinued === undefined ? {} : { allThreadsContinued })
			};
		}

		if (event.event === 'output') {
			const body = event.body;
			assertDapRecord(body, 'event:output', 'body');
			assertDapString(body.output, 'event:output', 'output');
			const category = dapOptionalString(body, 'category', 'event:output', '');
			const group = dapOptionalStringEnum(
				body,
				'group',
				['start', 'startCollapsed', 'end'],
				'event:output',
				''
			);
			const variablesReference = dapOptionalNonNegativeSafeInteger(
				body,
				'variablesReference',
				'event:output',
				''
			);
			const source =
				body.source === undefined
					? undefined
					: normalizeDapSource(body.source, 'event:output', 'source');
			const line = dapOptionalNonNegativeSafeInteger(body, 'line', 'event:output', '');
			const column = dapOptionalNonNegativeSafeInteger(body, 'column', 'event:output', '');
			return {
				type: 'output',
				output: body.output,
				...(category === undefined ? {} : { category }),
				...(group === undefined ? {} : { group }),
				...(variablesReference === undefined ? {} : { variablesReference }),
				...(source === undefined ? {} : { source }),
				...(line === undefined ? {} : { line }),
				...(column === undefined ? {} : { column }),
				...(body.data === undefined ? {} : { data: body.data })
			};
		}

		if (event.event === 'exited') {
			const body = event.body;
			assertDapRecord(body, 'event:exited', 'body');
			assertDapSafeInteger(body.exitCode, 'event:exited', 'exitCode');
			return { type: 'exited', exitCode: body.exitCode };
		}

		if (event.event === 'terminated') {
			const body = event.body;
			if (body !== undefined) assertDapRecord(body, 'event:terminated', 'body');
			return {
				type: 'terminated',
				...(body?.restart === undefined ? {} : { restart: body.restart })
			};
		}

		if (event.event === 'thread') {
			const body = event.body;
			assertDapRecord(body, 'event:thread', 'body');
			assertDapStringEnum(body.reason, ['started', 'exited'], 'event:thread', 'reason');
			assertDapPositiveSafeInteger(body.threadId, 'event:thread', 'threadId');
			return { type: 'thread', reason: body.reason, threadId: body.threadId };
		}

		if (event.event === 'process') {
			const body = event.body;
			assertDapRecord(body, 'event:process', 'body');
			assertDapString(body.name, 'event:process', 'name');
			const systemProcessId = dapOptionalSafeInteger(
				body,
				'systemProcessId',
				'event:process',
				''
			);
			const isLocalProcess = dapOptionalBoolean(body, 'isLocalProcess', 'event:process', '');
			const startMethod = dapOptionalStringEnum(
				body,
				'startMethod',
				['launch', 'attach', 'attachForSuspendedLaunch'],
				'event:process',
				''
			);
			const pointerSize = dapOptionalNonNegativeSafeInteger(
				body,
				'pointerSize',
				'event:process',
				''
			);
			return {
				type: 'process',
				name: body.name,
				...(systemProcessId === undefined ? {} : { systemProcessId }),
				...(isLocalProcess === undefined ? {} : { isLocalProcess }),
				...(startMethod === undefined ? {} : { startMethod }),
				...(pointerSize === undefined ? {} : { pointerSize })
			};
		}

		if (event.event === 'breakpoint') {
			const body = event.body;
			assertDapRecord(body, 'event:breakpoint', 'body');
			assertDapStringEnum(
				body.reason,
				['new', 'changed', 'removed'],
				'event:breakpoint',
				'reason'
			);
			assertDapRecord(body.breakpoint, 'event:breakpoint', 'breakpoint');
			const breakpointId = dapOptionalPositiveSafeInteger(
				body.breakpoint,
				'id',
				'event:breakpoint',
				'breakpoint'
			);
			const tracked =
				breakpointId === undefined ? undefined : this.#breakpointsById.get(breakpointId);
			if (breakpointId !== undefined && !tracked && body.reason !== 'new') {
				return null;
			}
			const eventLine = dapOptionalNonNegativeSafeInteger(
				body.breakpoint,
				'line',
				'event:breakpoint',
				'breakpoint'
			);
			const requestedLine = tracked?.requestedLine || eventLine || 1;
			const breakpoint = this.#normalizeBreakpoint(
				body.breakpoint,
				tracked?.source || {},
				requestedLine,
				'event:breakpoint',
				'breakpoint'
			);
			if (breakpoint.id !== undefined) {
				const storedBreakpoint = cloneResolvedBreakpoints([breakpoint])[0]!;
				const sourceKey = debugSourceKey(breakpoint.source);
				const previousSourceKey = tracked ? debugSourceKey(tracked.source) : sourceKey;
				if (previousSourceKey !== sourceKey) {
					this.#breakpointIdsBySource.get(previousSourceKey)?.delete(breakpoint.id);
					const previousBreakpoints =
						this.#breakpointsBySource.get(previousSourceKey) ?? [];
					this.#breakpointsBySource.set(
						previousSourceKey,
						previousBreakpoints.filter((candidate) => candidate.id !== breakpoint.id)
					);
				}
				if (body.reason === 'removed') {
					this.#breakpointsById.delete(breakpoint.id);
					this.#breakpointIdsBySource.get(previousSourceKey)?.delete(breakpoint.id);
					const current = this.#breakpointsBySource.get(previousSourceKey) ?? [];
					this.#breakpointsBySource.set(
						previousSourceKey,
						current.filter((candidate) => candidate.id !== breakpoint.id)
					);
				} else {
					this.#breakpointsById.set(breakpoint.id, storedBreakpoint);
					const ids = this.#breakpointIdsBySource.get(sourceKey) ?? new Set<number>();
					ids.add(breakpoint.id);
					this.#breakpointIdsBySource.set(sourceKey, ids);
					const current = this.#breakpointsBySource.get(sourceKey) ?? [];
					const index = current.findIndex((candidate) => candidate.id === breakpoint.id);
					const next = [...current];
					if (index < 0) next.push(storedBreakpoint);
					else next[index] = storedBreakpoint;
					this.#breakpointsBySource.set(sourceKey, next);
				}
			}
			return { type: 'breakpoint', reason: body.reason, breakpoint };
		}

		return { type: 'dap', event: event.event, body: event.body };
	}
}

export function createLldbDapAdapter(session: DapSession, options: LldbDapAdapterOptions = {}) {
	return new LldbDapAdapter(session, options);
}
