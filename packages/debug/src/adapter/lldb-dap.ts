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
	type DebugDataBreakpoint,
	type DebugDataBreakpointAccessType,
	type DebugDataBreakpointInfo,
	type DebugDataBreakpointInfoArguments,
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
	type DebugWriteMemoryResult,
	type ResolvedDataBreakpoint,
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
		/** Enable raw guest-memory writes only for a manifest-qualified runtime. */
		writeMemory?: boolean;
		/** Enable watchpoints only for a manifest-qualified LLDB/WAMR pair. */
		dataBreakpoints?: boolean;
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

const MAX_MEMORY_TRANSFER_BYTES = 256;
const MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS = 4096;
const MAX_DATA_BREAKPOINTS = 256;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function assertBoundedNonEmptyString(value: unknown, name: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	if (value.length > MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS) {
		throw new RangeError(
			`${name} must not exceed ${MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS} UTF-16 code units.`
		);
	}
}

function assertBoundedMemoryByteCount(value: unknown, name: string, allowZero: boolean) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
		throw new RangeError(
			`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`
		);
	}
	if (value > MAX_MEMORY_TRANSFER_BYTES) {
		throw new RangeError(`${name} must not exceed ${MAX_MEMORY_TRANSFER_BYTES}.`);
	}
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

function assertPositiveSafeInteger(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
}

function assertNonNegativeSafeInteger(value: number, name: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
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
	const supportsWriteMemory =
		options.featureSupport?.writeMemory === true &&
		capabilities.supportsWriteMemoryRequest === true;
	const supportsDataBreakpoints =
		options.featureSupport?.dataBreakpoints === true &&
		capabilities.supportsDataBreakpoints === true;

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
		supportsWriteMemory,
		supportsDataBreakpoints,
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
		assertPositiveSafeInteger(threadId, 'threadId');
		if (startFrame !== undefined) assertNonNegativeSafeInteger(startFrame, 'startFrame');
		if (levels !== undefined) assertNonNegativeSafeInteger(levels, 'levels');

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
		assertPositiveSafeInteger(frameId, 'frameId');
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
		assertPositiveSafeInteger(variablesReference, 'variablesReference');
		if (start !== undefined) assertNonNegativeSafeInteger(start, 'start');
		if (count !== undefined) assertNonNegativeSafeInteger(count, 'count');

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
		assertBoundedNonEmptyString(memoryReference, 'memoryReference');
		if (!Number.isSafeInteger(offset)) throw new RangeError('offset must be a safe integer.');
		assertBoundedMemoryByteCount(count, 'count', true);

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
			const maximumEncodedLength = Math.ceil(count / 3) * 4;
			if (encodedData.length > maximumEncodedLength) {
				invalidDapResponse(
					'readMemory',
					'data',
					`encoded data exceeds the ${maximumEncodedLength}-character limit for a ${count}-byte request`
				);
			}
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
			data = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) {
				data[index] = binary.charCodeAt(index);
			}
		}
		if (data.byteLength + unreadableBytes > count) {
			invalidDapResponse(
				'readMemory',
				'unreadableBytes',
				`reported ${data.byteLength} readable and ${unreadableBytes} unreadable bytes for a ${count}-byte request`
			);
		}
		return {
			address: response.address,
			data,
			unreadableBytes
		} satisfies DebugMemory;
	}

	async evaluate(expression: string, frameId?: number) {
		this.#requireCapability('supportsEvaluate', 'evaluate expressions');
		if (frameId !== undefined) assertPositiveSafeInteger(frameId, 'frameId');
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

	async writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial = false
	) {
		this.#requireCapability('supportsWriteMemory', 'write memory');
		assertBoundedNonEmptyString(memoryReference, 'memoryReference');
		if (!Number.isSafeInteger(offset)) throw new RangeError('offset must be a safe integer.');
		if (!(data instanceof Uint8Array)) throw new TypeError('data must be a Uint8Array.');
		if (data.byteLength > MAX_MEMORY_TRANSFER_BYTES) {
			throw new RangeError(`data must not exceed ${MAX_MEMORY_TRANSFER_BYTES} bytes.`);
		}
		if (typeof allowPartial !== 'boolean') {
			throw new TypeError('allowPartial must be a boolean.');
		}
		const chunks: string[] = [];
		for (let start = 0; start < data.byteLength; start += 0x8000) {
			chunks.push(String.fromCharCode(...data.subarray(start, start + 0x8000)));
		}
		const response = await this.#session.request<unknown>('writeMemory', {
			memoryReference,
			offset,
			allowPartial,
			data: globalThis.btoa(chunks.join(''))
		});
		assertDapRecord(response, 'writeMemory', 'body');
		assertDapNonNegativeSafeInteger(response.bytesWritten, 'writeMemory', 'bytesWritten');
		if (response.bytesWritten > data.byteLength) {
			invalidDapResponse(
				'writeMemory',
				'bytesWritten',
				`reported ${response.bytesWritten} bytes written for ${data.byteLength} input bytes`
			);
		}
		const responseOffset = dapOptionalSafeInteger(response, 'offset', 'writeMemory', '');
		return {
			...(responseOffset === undefined ? {} : { offset: responseOffset }),
			bytesWritten: response.bytesWritten
		} satisfies DebugWriteMemoryResult;
	}

	async dataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
		this.#requireCapability('supportsDataBreakpoints', 'data breakpoints');
		assertBoundedNonEmptyString(arguments_.name, 'name');
		if (arguments_.variablesReference !== undefined) {
			assertNonNegativeSafeInteger(arguments_.variablesReference, 'variablesReference');
		}
		if (arguments_.frameId !== undefined) {
			assertPositiveSafeInteger(arguments_.frameId, 'frameId');
		}
		if (arguments_.bytes !== undefined) {
			assertBoundedMemoryByteCount(arguments_.bytes, 'bytes', false);
		}
		if (arguments_.asAddress !== undefined && typeof arguments_.asAddress !== 'boolean') {
			throw new TypeError('asAddress must be a boolean.');
		}
		const response = await this.#session.request<unknown>('dataBreakpointInfo', {
			name: arguments_.name,
			...(arguments_.variablesReference === undefined
				? {}
				: { variablesReference: arguments_.variablesReference }),
			...(arguments_.frameId === undefined ? {} : { frameId: arguments_.frameId }),
			...(arguments_.asAddress === undefined ? {} : { asAddress: arguments_.asAddress }),
			...(arguments_.bytes === undefined ? {} : { bytes: arguments_.bytes })
		});
		assertDapRecord(response, 'dataBreakpointInfo', 'body');
		assertDapString(response.description, 'dataBreakpointInfo', 'description');
		let dataId: string | undefined;
		if (response.dataId !== undefined && response.dataId !== null) {
			assertDapString(response.dataId, 'dataBreakpointInfo', 'dataId');
			if (response.dataId.length === 0) {
				invalidDapResponse('dataBreakpointInfo', 'dataId', 'expected a non-empty string');
			}
			if (response.dataId.length > MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS) {
				invalidDapResponse(
					'dataBreakpointInfo',
					'dataId',
					`expected at most ${MAX_DEBUG_PROTOCOL_STRING_CODE_UNITS} UTF-16 code units`
				);
			}
			dataId = response.dataId;
		}
		let accessTypes: DebugDataBreakpointAccessType[] | undefined;
		if (response.accessTypes !== undefined) {
			if (!Array.isArray(response.accessTypes)) {
				invalidDapResponse('dataBreakpointInfo', 'accessTypes', 'expected an array');
			}
			if (response.accessTypes.length > 3) {
				invalidDapResponse(
					'dataBreakpointInfo',
					'accessTypes',
					'expected at most 3 entries'
				);
			}
			const seenAccessTypes = new Set<DebugDataBreakpointAccessType>();
			accessTypes = response.accessTypes.map((accessType, index) => {
				assertDapStringEnum(
					accessType,
					['read', 'write', 'readWrite'],
					'dataBreakpointInfo',
					`accessTypes[${index}]`
				);
				if (seenAccessTypes.has(accessType)) {
					invalidDapResponse(
						'dataBreakpointInfo',
						`accessTypes[${index}]`,
						'expected a unique access type'
					);
				}
				seenAccessTypes.add(accessType);
				return accessType;
			});
		}
		const canPersist = dapOptionalBoolean(response, 'canPersist', 'dataBreakpointInfo', '');
		return {
			...(dataId === undefined ? {} : { dataId }),
			description: response.description,
			...(accessTypes === undefined ? {} : { accessTypes }),
			...(canPersist === undefined ? {} : { canPersist })
		} satisfies DebugDataBreakpointInfo;
	}

	async setDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
		this.#requireCapability('supportsDataBreakpoints', 'data breakpoints');
		if (!Array.isArray(breakpoints)) throw new TypeError('breakpoints must be an array.');
		if (breakpoints.length > MAX_DATA_BREAKPOINTS) {
			throw new RangeError(
				`breakpoints must not contain more than ${MAX_DATA_BREAKPOINTS} entries.`
			);
		}
		for (let index = 0; index < breakpoints.length; index += 1) {
			const breakpoint = breakpoints[index];
			if (!isObject(breakpoint) || Array.isArray(breakpoint)) {
				throw new TypeError(`breakpoints[${index}] must be an object.`);
			}
			assertBoundedNonEmptyString(breakpoint.dataId, `breakpoints[${index}].dataId`);
			if (
				breakpoint.accessType !== undefined &&
				!(['read', 'write', 'readWrite'] as const).includes(breakpoint.accessType)
			) {
				throw new TypeError(
					`breakpoints[${index}].accessType must be read, write, or readWrite.`
				);
			}
		}
		const requestBreakpoints = breakpoints.map((breakpoint) => {
			return {
				dataId: breakpoint.dataId,
				...(breakpoint.accessType === undefined
					? {}
					: { accessType: breakpoint.accessType })
			};
		});
		const response = await this.#session.request<unknown>('setDataBreakpoints', {
			breakpoints: requestBreakpoints
		});
		const responseBreakpoints = dapResponseCollection(
			response,
			'setDataBreakpoints',
			'breakpoints'
		);
		if (responseBreakpoints.length !== requestBreakpoints.length) {
			invalidDapResponse(
				'setDataBreakpoints',
				'breakpoints',
				`expected ${requestBreakpoints.length} entries but received ${responseBreakpoints.length}`
			);
		}
		return responseBreakpoints.map((breakpoint, index) => {
			const path = `breakpoints[${index}]`;
			assertDapRecord(breakpoint, 'setDataBreakpoints', path);
			assertDapBoolean(breakpoint.verified, 'setDataBreakpoints', `${path}.verified`);
			const id = dapOptionalNonNegativeSafeInteger(
				breakpoint,
				'id',
				'setDataBreakpoints',
				path
			);
			const message = dapOptionalString(breakpoint, 'message', 'setDataBreakpoints', path);
			return {
				...(id === undefined ? {} : { id }),
				verified: breakpoint.verified,
				...(message === undefined ? {} : { message })
			} satisfies ResolvedDataBreakpoint;
		});
	}

	onEvent(listener: (event: DebugAdapterEvent) => void) {
		return this.#events.subscribe(listener);
	}

	async #threadRequest(command: string, threadId: number) {
		this.#requireInitialized();
		assertPositiveSafeInteger(threadId, 'threadId');
		await this.#session.request(command, { threadId });
	}

	#requireInitialized() {
		if (!this.#capabilities) {
			throw new DebugAdapterStateError('The LLDB DAP adapter has not been initialized.');
		}
		return this.#capabilities;
	}

	#requireCapability(
		capability:
			| 'supportsDataBreakpoints'
			| 'supportsEvaluate'
			| 'supportsReadMemory'
			| 'supportsWriteMemory',
		operation: string
	) {
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
