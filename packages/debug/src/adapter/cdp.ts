import { createDebugAdapterEventChannel } from './event-channel.js';
import type { CdpEvent, CdpTransport } from './cdp-transport.js';
import {
	DebugAdapterStateError,
	UnsupportedDebugOperationError,
	type DebugAdapter,
	type DebugAdapterEvent,
	type DebugCapabilities,
	type DebugDataBreakpoint,
	type DebugDataBreakpointInfoArguments,
	type DebugDisconnectOptions,
	type DebugLaunchConfig,
	type DebugSource,
	type DebugStackFrame,
	type DebugScope,
	type DebugVariable,
	type ResolvedBreakpoint
} from './types.js';

export interface CdpWasmLocation {
	address: number;
	endAddress?: number;
	sourcePath: string;
	line: number;
	functionName?: string;
	/** Compiler-provided inlining depth within the native Wasm function. */
	inlineDepth?: number;
}

export interface CdpDebugAdapterOptions {
	transport: CdpTransport;
	source: DebugSource;
	/** The sourceURL emitted by the runtime, unique to this execution. */
	url?: string;
	/** Native Function/AsyncFunction contributes two generated header lines. */
	lineOffset?: number;
	/** TeaVM GC currently supplies source locations but no Java variable metadata. */
	variables?: boolean;
}

type NativeFrame = {
	callFrameId: string;
	functionName: string;
	url: string;
	location: { scriptId: string; lineNumber: number; columnNumber: number };
	scopeChain: Array<{ type: string; name?: string; object: { objectId?: string } }>;
};

/** Source locations and values come from the browser's paused VM, never source probes. */
export class CdpDebugAdapter implements DebugAdapter {
	readonly kind = 'cdp' as const;
	readonly capabilities: DebugCapabilities;
	readonly scripts = new Map<string, Record<string, any>>();
	private readonly events = createDebugAdapterEventChannel();
	private unsubscribe: () => void;
	private initialized = false;
	private closed = false;
	private generation = 0;
	private nextReference = 1;
	private nextBreakpoint = 1;
	private frames = new Map<number, NativeFrame>();
	private objects = new Map<number, string>();
	private objectReferences = new Map<string, number>();
	private wasm = new Map<string, CdpWasmLocation[]>();
	private breakpoints = new Map<string, Array<ResolvedBreakpoint & { nativeIds: string[] }>>();
	private breakpointVersions = new Map<string, number>();
	private entryId?: string;
	private entryTemporary = false;
	private entryRequested = false;
	private commandReason = 'pause';
	private sourceStep?: {
		method: string;
		functionName: string;
		scriptId: string;
		path?: string;
		line: number;
		depth: number;
		inlineDepth: number;
		inlineExit: boolean;
		sourceMethod?: string;
		remaining: number;
	};
	private hiddenStep = false;

	constructor(private readonly options: CdpDebugAdapterOptions) {
		const values = options.variables !== false;
		this.capabilities = Object.freeze({
			supportsConfigurationDone: false,
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
			supportsScopes: values,
			supportsVariables: values,
			supportsEvaluate: values,
			supportsEvaluateForHovers: false,
			supportsReadMemory: false,
			supportsWriteMemory: false,
			supportsDataBreakpoints: false,
			supportsSetVariable: false,
			supportsRestart: false,
			supportsTerminate: true
		});
		this.unsubscribe = options.transport.onEvent((event) => this.receive(event));
	}

	async initialize() {
		if (this.closed) throw new DebugAdapterStateError('Debugger is closed');
		if (!this.initialized) {
			await this.options.transport.request('Debugger.enable');
			if (this.options.url) {
				await this.options.transport.request('Debugger.setBlackboxPatterns', {
					patterns: ['^(?!wasm-idle://)']
				});
			}
			this.initialized = true;
		}
		return this.capabilities;
	}

	registerWasmSource(scriptId: string, locations: readonly CdpWasmLocation[]) {
		this.wasm.set(
			scriptId,
			locations.map((item) => ({ ...item })).sort((a, b) => a.address - b.address)
		);
	}

	async launch(config: DebugLaunchConfig) {
		await this.initialize();
		if (config.stopOnEntry) {
			const location = this.generatedLocations(this.options.source.path || '', 1)[0];
			const firstLine = location ? this.original(location)?.line : 1;
			const existing = (this.breakpoints.get(this.options.source.path || '') || []).find(
				(breakpoint) => breakpoint.line === firstLine && breakpoint.nativeIds.length
			);
			if (existing) {
				this.entryId = existing.nativeIds[0];
				this.entryTemporary = false;
			} else if (location) {
				const result = await this.options.transport.request('Debugger.setBreakpoint', {
					location
				});
				this.entryId = result.breakpointId;
				this.entryTemporary = true;
			} else if (this.options.url) {
				const result = await this.options.transport.request('Debugger.setBreakpointByUrl', {
					url: this.options.url,
					lineNumber: this.options.lineOffset ?? 0,
					columnNumber: 0
				});
				this.entryId = result.breakpointId;
				this.entryTemporary = true;
			}
			this.entryRequested = Boolean(this.entryId);
		}
	}

	private generatedLocations(sourcePath: string, line: number) {
		const result: Array<{ scriptId: string; lineNumber: number; columnNumber: number }> = [];
		for (const [scriptId, locations] of this.wasm) {
			const matching = locations.filter(
				(item) => item.sourcePath === sourcePath && item.line >= line
			);
			const nextLine = Math.min(...matching.map((item) => item.line));
			for (const item of matching)
				if (item.line === nextLine) {
					result.push({ scriptId, lineNumber: 0, columnNumber: item.address });
				}
		}
		return result;
	}

	private original(location: NativeFrame['location'], url = '') {
		const locations = this.wasm.get(location.scriptId);
		if (locations) {
			let left = 0;
			let right = locations.length;
			while (left < right) {
				const middle = (left + right) >>> 1;
				if (locations[middle].address <= location.columnNumber) left = middle + 1;
				else right = middle;
			}
			const found = locations[left - 1];
			if (
				!found ||
				(found.endAddress !== undefined && location.columnNumber >= found.endAddress)
			)
				return null;
			return {
				source: { path: found.sourcePath },
				line: found.line,
				column: 1,
				name: found.functionName,
				inlineDepth: found.inlineDepth ?? 0
			};
		}
		const scriptUrl = this.scripts.get(location.scriptId)?.url || url;
		if (scriptUrl !== this.options.url) return null;
		return {
			source: { ...this.options.source },
			line: Math.max(1, location.lineNumber + 1 - (this.options.lineOffset ?? 0)),
			column: location.columnNumber + 1,
			name: undefined,
			inlineDepth: 0
		};
	}

	async setBreakpoints(source: DebugSource, lines: number[]): Promise<ResolvedBreakpoint[]> {
		if (
			!source.path ||
			lines.some((line) => !Number.isSafeInteger(line) || line < 1) ||
			lines.length > 1024
		) {
			throw new RangeError(
				'Breakpoints require a source path and at most 1024 positive line numbers'
			);
		}
		const path = source.path;
		const version = (this.breakpointVersions.get(path) || 0) + 1;
		this.breakpointVersions.set(path, version);
		const old = this.breakpoints.get(path) || [];
		this.breakpoints.set(path, []);
		await Promise.all(
			old
				.flatMap((item) => item.nativeIds)
				.map((breakpointId) =>
					this.options.transport.request('Debugger.removeBreakpoint', { breakpointId })
				)
		);
		const next: Array<ResolvedBreakpoint & { nativeIds: string[] }> = [];
		for (const line of [...new Set(lines)]) {
			const breakpoint: ResolvedBreakpoint & { nativeIds: string[] } = {
				id: this.nextBreakpoint++,
				requestedLine: line,
				line,
				source: { ...source },
				verified: false,
				nativeIds: []
			};
			const locations = this.generatedLocations(path, line);
			if (locations.length) {
				for (const location of locations) {
					const response = await this.options.transport.request(
						'Debugger.setBreakpoint',
						{ location }
					);
					breakpoint.nativeIds.push(response.breakpointId);
					breakpoint.verified = true;
					breakpoint.line = this.original(response.actualLocation)?.line || line;
				}
			} else if (this.options.url && path === this.options.source.path) {
				const response = await this.options.transport.request(
					'Debugger.setBreakpointByUrl',
					{
						url: this.options.url,
						lineNumber: line - 1 + (this.options.lineOffset ?? 0),
						columnNumber: 0
					}
				);
				breakpoint.nativeIds.push(response.breakpointId);
				breakpoint.verified = response.locations?.length > 0;
				if (response.locations?.[0])
					breakpoint.line = this.original(response.locations[0])?.line || line;
			} else {
				breakpoint.message = 'No executable location in this source';
			}
			next.push(breakpoint);
		}
		if (this.closed || this.breakpointVersions.get(path) !== version) {
			await Promise.all(
				next
					.flatMap((item) => item.nativeIds)
					.map((breakpointId) =>
						this.options.transport
							.request('Debugger.removeBreakpoint', { breakpointId })
							.catch(() => undefined)
					)
			);
			return this.breakpoints.get(path) || [];
		}
		this.breakpoints.set(path, next);
		return next.map(({ nativeIds: _, ...item }) => item);
	}

	private receive(event: CdpEvent) {
		if (this.closed) return;
		const params = event.params || {};
		if (event.method === 'Debugger.scriptParsed' && typeof params.scriptId === 'string') {
			this.scripts.set(params.scriptId, params);
		} else if (event.method === 'Debugger.paused') {
			this.clearStop();
			for (const frame of params.callFrames || []) {
				if (
					typeof frame.callFrameId === 'string' &&
					frame.location &&
					this.original(frame.location, frame.url)
				) {
					this.frames.set(this.nextReference++, frame);
				}
			}
			const hit = params.hitBreakpoints || [];
			const first = this.frames.values().next().value as NativeFrame | undefined;
			const location = first && this.original(first.location, first.url);
			const step = this.sourceStep;
			if (
				step &&
				!hit.length &&
				params.reason !== 'exception' &&
				params.reason !== 'promiseRejection'
			) {
				const sameLine =
					location?.source.path === step.path &&
					location?.line === step.line &&
					location?.name === step.sourceMethod &&
					location?.inlineDepth === step.inlineDepth &&
					this.frames.size === step.depth;
				const insideInline =
					location &&
					this.frames.size >= step.depth &&
					(step.inlineExit
						? location.inlineDepth >= step.inlineDepth
						: step.method === 'Debugger.stepOver' &&
							location.inlineDepth > step.inlineDepth);
				const outsideUserSource = first !== params.callFrames?.[0];
				if (
					(!location || sameLine || insideInline || outsideUserSource) &&
					step.remaining-- > 0
				) {
					// Wasm engine steps are instruction based. Coalesce them while the
					// compiler maps execution to the same Java source line.
					this.hiddenStep = true;
					const nativeTop = params.callFrames?.[0] as NativeFrame | undefined;
					const sameFunction =
						nativeTop?.location.scriptId === step.scriptId &&
						nativeTop?.functionName === step.functionName;
					// TeaVM can leave ranges of generated instructions between two
					// mapped Java statements in the same native (often inlined) function.
					// Keep stepping through that gap instead of running past the next line.
					const method = sameFunction
						? step.method
						: nativeTop && this.wasm.has(nativeTop.location.scriptId)
							? 'Debugger.stepOut'
							: !location
								? 'Debugger.resume'
								: outsideUserSource
									? 'Debugger.stepOut'
									: step.method;
					if (method === 'Debugger.resume') this.sourceStep = undefined;
					void this.options.transport.request(method).catch((error) => {
						this.hiddenStep = false;
						this.events.emit({
							type: 'output',
							category: 'stderr',
							output: `${String(error)}\n`
						});
						this.events.emit({
							type: 'stopped',
							threadId: 1,
							reason: 'step',
							allThreadsStopped: true
						});
					});
					return;
				}
			}
			this.sourceStep = undefined;
			this.hiddenStep = false;
			const entry = this.entryRequested && hit.includes(this.entryId);
			this.entryRequested = false;
			if (this.entryId && this.entryTemporary) {
				void this.options.transport
					.request('Debugger.removeBreakpoint', { breakpointId: this.entryId })
					.catch(() => undefined);
			}
			this.entryId = undefined;
			this.events.emit({
				type: 'stopped',
				threadId: 1,
				allThreadsStopped: true,
				reason: entry
					? 'entry'
					: hit.length
						? 'breakpoint'
						: params.reason === 'exception'
							? 'exception'
							: this.commandReason
			});
		} else if (event.method === 'Debugger.resumed') {
			this.clearStop();
			if (!this.hiddenStep)
				this.events.emit({ type: 'continued', threadId: 1, allThreadsContinued: true });
		} else if (event.method === 'Debugger.breakpointResolved' && params.location) {
			for (const source of this.breakpoints.values())
				for (const breakpoint of source) {
					if (!breakpoint.nativeIds.includes(params.breakpointId)) continue;
					breakpoint.verified = true;
					breakpoint.line = this.original(params.location)?.line || breakpoint.line;
					const { nativeIds: _, ...resolved } = breakpoint;
					this.events.emit({
						type: 'breakpoint',
						reason: 'changed',
						breakpoint: resolved
					});
				}
		} else if (event.method === 'Inspector.detached') {
			this.clearStop();
			this.events.emit({
				type: 'output',
				category: 'stderr',
				output: `Debugger disconnected: ${params.reason || 'connection closed'}\n`
			});
			this.events.emit({ type: 'terminated' });
		}
	}

	private clearStop() {
		this.generation += 1;
		this.frames.clear();
		this.objects.clear();
		this.objectReferences.clear();
	}
	private async control(method: string, reason: string, threadId: number) {
		if (threadId !== 1 || this.closed)
			throw new DebugAdapterStateError('Debugger thread is unavailable');
		this.commandReason = reason;
		this.sourceStep = undefined;
		this.hiddenStep = false;
		const first = this.frames.values().next().value as NativeFrame | undefined;
		if (reason === 'step' && first && this.wasm.has(first.location.scriptId)) {
			const location = this.original(first.location, first.url)!;
			const inlineExit = method === 'Debugger.stepOut' && location.inlineDepth > 0;
			// Native stepOut exits the entire physical function. Inlined Java methods
			// need native instruction steps until compiler metadata returns to the caller.
			if (inlineExit) method = 'Debugger.stepOver';
			this.sourceStep = {
				method,
				functionName: first.functionName,
				scriptId: first.location.scriptId,
				path: location.source.path,
				line: location.line,
				depth: this.frames.size,
				inlineDepth: location.inlineDepth,
				inlineExit,
				sourceMethod: location.name,
				remaining: 1000
			};
		}
		await this.options.transport.request(method);
	}
	continue(threadId: number) {
		return this.control('Debugger.resume', 'pause', threadId);
	}
	pause(threadId: number) {
		return this.control('Debugger.pause', 'pause', threadId);
	}
	next(threadId: number) {
		return this.control('Debugger.stepOver', 'step', threadId);
	}
	stepIn(threadId: number) {
		return this.control('Debugger.stepInto', 'step', threadId);
	}
	stepOut(threadId: number) {
		return this.control('Debugger.stepOut', 'step', threadId);
	}
	async threads() {
		return [{ id: 1, name: 'Execution Worker' }];
	}
	async stackTrace(
		_threadId: number,
		startFrame = 0,
		levels?: number
	): Promise<DebugStackFrame[]> {
		return [...this.frames]
			.slice(startFrame, levels === undefined ? undefined : startFrame + levels)
			.map(([id, frame]) => {
				const location = this.original(frame.location, frame.url)!;
				return {
					id,
					name: location.name || frame.functionName || '<main>',
					source: location.source,
					line: location.line,
					column: location.column
				};
			});
	}
	private reference(objectId?: string) {
		if (!objectId) return 0;
		let reference = this.objectReferences.get(objectId);
		if (!reference) {
			reference = this.nextReference++;
			this.objects.set(reference, objectId);
			this.objectReferences.set(objectId, reference);
		}
		return reference;
	}
	async scopes(frameId: number): Promise<DebugScope[]> {
		if (!this.capabilities.supportsScopes) return [];
		const frame = this.frames.get(frameId);
		if (!frame) return [];
		return frame.scopeChain
			.filter((scope) => scope.object?.objectId)
			.map((scope) => ({
				name: scope.name || scope.type,
				presentationHint: scope.type === 'local' ? 'locals' : undefined,
				variablesReference: this.reference(scope.object.objectId),
				expensive: scope.type === 'global'
			}));
	}
	private value(remote: Record<string, any>) {
		const value =
			remote.unserializableValue ??
			(typeof remote.value === 'string'
				? JSON.stringify(remote.value)
				: remote.value !== undefined
					? String(remote.value)
					: (remote.description ?? remote.type ?? 'undefined'));
		return {
			value: String(value).slice(0, 4096),
			type: remote.className || remote.subtype || remote.type,
			variablesReference: this.reference(remote.objectId)
		};
	}
	async variables(variablesReference: number, start = 0, count = 50): Promise<DebugVariable[]> {
		if (
			!Number.isSafeInteger(start) ||
			start < 0 ||
			!Number.isSafeInteger(count) ||
			count < 0 ||
			count > 1000
		) {
			throw new RangeError('Invalid variable page');
		}
		const objectId = this.objects.get(variablesReference);
		if (!objectId) return [];
		const generation = this.generation;
		const response = await this.options.transport.request('Runtime.getProperties', {
			objectId,
			ownProperties: true,
			generatePreview: false
		});
		if (generation !== this.generation) return [];
		if (!Array.isArray(response.result)) throw new Error('Invalid CDP property response');
		return response.result.slice(start, start + count).map((property: any) => ({
			name: String(property.name),
			...(property.value
				? this.value(property.value)
				: { value: property.get ? '<getter>' : 'undefined', variablesReference: 0 })
		}));
	}
	async evaluate(expression: string, frameId?: number) {
		if (!this.capabilities.supportsEvaluate)
			throw new UnsupportedDebugOperationError('evaluate');
		if (expression.length > 4096) throw new RangeError('Expression exceeds 4096 characters');
		const frame =
			frameId === undefined ? this.frames.values().next().value : this.frames.get(frameId);
		if (!frame) throw new DebugAdapterStateError('Evaluation requires a paused frame');
		const generation = this.generation;
		const response = await this.options.transport.request('Debugger.evaluateOnCallFrame', {
			callFrameId: frame.callFrameId,
			expression,
			silent: true,
			throwOnSideEffect: true,
			returnByValue: false,
			generatePreview: false
		});
		if (generation !== this.generation)
			throw new DebugAdapterStateError('Evaluation became stale');
		if (response.exceptionDetails)
			throw new Error(response.exceptionDetails.text || 'Evaluation failed');
		const { value, ...rest } = this.value(response.result || {});
		return { result: value, ...rest };
	}
	async disconnect(_options?: DebugDisconnectOptions) {
		if (this.closed) return;
		this.closed = true;
		this.clearStop();
		this.unsubscribe();
		await this.options.transport.disconnect();
	}
	onEvent(listener: (event: DebugAdapterEvent) => void) {
		return this.events.subscribe(listener);
	}
	async readMemory(_reference: string, _offset: number, _count: number): Promise<never> {
		throw new UnsupportedDebugOperationError('readMemory');
	}
	async writeMemory(
		_reference: string,
		_offset: number,
		_data: Uint8Array,
		_partial?: boolean
	): Promise<never> {
		throw new UnsupportedDebugOperationError('writeMemory');
	}
	async dataBreakpointInfo(_args: DebugDataBreakpointInfoArguments): Promise<never> {
		throw new UnsupportedDebugOperationError('dataBreakpointInfo');
	}
	async setDataBreakpoints(_breakpoints: DebugDataBreakpoint[]): Promise<never> {
		throw new UnsupportedDebugOperationError('setDataBreakpoints');
	}
}
