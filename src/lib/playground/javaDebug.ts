import { DebugCommandMailbox } from './debugMailbox';
import type { DebugCommand, DebugScope, DebugSessionEvent, DebugVariable } from './options';

export interface JavaDebugEvaluationContext {
	bindings: Array<{ name: string; type: string; value: string | null; unavailable?: string }>;
}

export interface JavaDebugSessionOptions {
	evaluate?: (
		expression: string,
		context: JavaDebugEvaluationContext,
		signal: AbortSignal
	) => Promise<string>;
	requestTimeoutMs?: number;
	evaluationTimeoutMs?: number;
}

interface JavaDebugMessage {
	consumed?: boolean;
	event?: DebugSessionEvent;
	stopId?: number;
	response?: { id: number; stopId: number; value?: unknown; error?: string };
}

interface PendingRequest {
	stopId: number;
	resolve(value: unknown): void;
	reject(error: Error): void;
	cleanup(): void;
}

const MAX_PENDING_REQUESTS = 64;
const MAX_VARIABLE_PAGE = 1000;
const validId = (value: unknown): value is number =>
	Number.isSafeInteger(value) && Number(value) > 0;

function timeout(value: number | undefined, fallback: number) {
	const milliseconds = value ?? fallback;
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647)
		throw new RangeError('Invalid Java debugger request timeout');
	return milliseconds;
}

export class JavaDebugSession {
	readonly mailbox = new DebugCommandMailbox('Java');
	private closed = false;
	private stopId?: number;
	private frameId?: number;
	private generation = 0;
	private selectionVersion = 0;
	private selectingFrame = false;
	private frames = new Set<number>();
	private references = new Set<number>();
	private nextRequest = 0;
	private pending = new Map<number, PendingRequest>();
	private evaluations = new Set<{ cancel(error: Error): void }>();
	private readonly requestTimeoutMs: number;
	private readonly evaluationTimeoutMs: number;

	constructor(
		private readonly sourcePath: string,
		private readonly emit: (event: DebugSessionEvent) => void,
		private readonly options: JavaDebugSessionOptions = {}
	) {
		this.requestTimeoutMs = timeout(options.requestTimeoutMs, 10_000);
		this.evaluationTimeoutMs = timeout(options.evaluationTimeoutMs, 45_000);
	}

	handle(message: JavaDebugMessage) {
		if (this.closed) return;
		if (message.consumed) this.mailbox.flush();
		if (message.response) {
			const response = message.response;
			const pending = this.pending.get(response.id);
			if (pending && pending.stopId === response.stopId && response.stopId === this.stopId) {
				this.pending.delete(response.id);
				pending.cleanup();
				if (typeof response.error === 'string') pending.reject(new Error(response.error));
				else pending.resolve(response.value);
			}
		}
		const event = message.event;
		if (!event) return;
		if (event.type === 'stop') {
			this.dispose();
			return;
		}
		if (event.type === 'pause') {
			this.invalidate(new Error('Java debugger values became stale after a new pause'));
			// Older producers can still deliver events and accept controls, but do not
			// expose unversioned values through the request protocol.
			this.stopId = validId(message.stopId) ? message.stopId : undefined;
			for (const frame of event.callStack) {
				if (validId(frame.id)) this.frames.add(frame.id);
			}
			if (validId(event.frameId)) {
				this.frames.add(event.frameId);
				this.frameId = event.frameId;
			}
			for (const scope of event.scopes ?? []) {
				if (validId(scope.variablesReference))
					this.references.add(scope.variablesReference);
				this.rememberVariables(scope.variables);
			}
			this.rememberVariables(event.locals);
		} else if (event.type === 'resume') {
			this.invalidate(new Error('Java debugger values became stale after resume'));
		}
		this.emit(event);
	}

	command(command: DebugCommand) {
		this.mailbox.send(JSON.stringify({ op: 'control', command }));
		this.invalidate(new Error('Java debugger values became stale after a control command'));
	}

	pause() {
		this.mailbox.send(JSON.stringify({ op: 'pause' }));
	}

	setBreakpoints(lines: number[], sourcePath = this.sourcePath) {
		if (lines.length > 1024 || lines.some((line) => !Number.isSafeInteger(line) || line < 1))
			throw new RangeError('Invalid Java breakpoint lines');
		this.mailbox.send(JSON.stringify({ op: 'breakpoints', lines, sourcePath }));
	}

	async scopes(frameId: number, select = true): Promise<DebugScope[]> {
		this.assertPaused();
		if (!validId(frameId) || !this.frames.has(frameId))
			throw new Error('Unknown or stale Java frame');
		const generation = this.generation;
		const selection = select ? ++this.selectionVersion : this.selectionVersion;
		if (select) {
			this.selectingFrame = true;
			this.cancelEvaluations(new Error('Java evaluation became stale after frame selection'));
		}
		try {
			const value = await this.request('scopes', { frameId });
			this.assertCurrent(generation);
			if (select && selection !== this.selectionVersion)
				throw new Error('Java frame selection became stale');
			if (!Array.isArray(value) || value.length > 64)
				throw new Error('Invalid Java debugger scopes response');
			for (const scope of value) {
				if (
					!scope ||
					typeof scope.name !== 'string' ||
					!validId(scope.variablesReference) ||
					typeof scope.expensive !== 'boolean'
				)
					throw new Error('Invalid Java debugger scope');
				this.validateVariables(scope.variables);
			}
			for (const scope of value) {
				this.references.add(scope.variablesReference);
				this.rememberVariables(scope.variables);
			}
			if (select) this.frameId = frameId;
			return value as DebugScope[];
		} finally {
			if (select && selection === this.selectionVersion) this.selectingFrame = false;
		}
	}

	async variables(reference: number, start = 0, count = 50): Promise<DebugVariable[]> {
		this.assertPaused();
		if (!validId(reference) || !this.references.has(reference))
			throw new Error('Unknown or stale Java variable reference');
		if (
			!Number.isSafeInteger(start) ||
			start < 0 ||
			!Number.isSafeInteger(count) ||
			count < 0 ||
			count > MAX_VARIABLE_PAGE
		)
			throw new RangeError('Invalid Java variable page');
		const generation = this.generation;
		const value = await this.request('variables', { reference, start, count });
		this.assertCurrent(generation);
		this.validateVariables(value);
		if (value.length > count)
			throw new Error('Java variable response exceeded its requested page');
		this.rememberVariables(value);
		return value;
	}

	async evaluate(expression: string): Promise<string> {
		if (typeof expression !== 'string' || expression.length > 4096)
			throw new RangeError('Java expression exceeds 4096 characters');
		const evaluate = this.options.evaluate;
		if (!evaluate) throw new Error('Java expression evaluation is unavailable');
		this.assertPaused();
		if (this.selectingFrame || this.frameId === undefined)
			throw new Error('Java evaluation requires a selected paused frame');
		if (this.evaluations.size + this.pending.size >= MAX_PENDING_REQUESTS)
			throw new Error('Java debugger request queue is full');
		const frameId = this.frameId;
		const generation = this.generation;
		const controller = new AbortController();
		return await new Promise<string>((resolve, reject) => {
			const finish = (error?: Error, value?: string) => {
				if (!this.evaluations.delete(operation)) return;
				clearTimeout(timer);
				if (error) {
					controller.abort(error);
					reject(error);
				} else resolve(value!);
			};
			const operation = { cancel: (error: Error) => finish(error) };
			const timer = setTimeout(
				() => finish(new Error('Java evaluation timed out')),
				this.evaluationTimeoutMs
			);
			this.evaluations.add(operation);
			void this.request('context', { frameId }, controller.signal)
				.then((value) => {
					this.assertCurrent(generation);
					controller.signal.throwIfAborted();
					const context = value as JavaDebugEvaluationContext | null;
					if (
						!context ||
						!Array.isArray(context.bindings) ||
						context.bindings.length > 1024 ||
						context.bindings.some(
							(binding) =>
								!binding ||
								typeof binding.name !== 'string' ||
								typeof binding.type !== 'string' ||
								(binding.value !== null && typeof binding.value !== 'string') ||
								(binding.unavailable !== undefined &&
									typeof binding.unavailable !== 'string')
						)
					)
						throw new Error('Invalid Java evaluation context');
					return evaluate(
						expression,
						{ bindings: context.bindings.map((binding) => ({ ...binding })) },
						controller.signal
					);
				})
				.then(
					(value) => {
						if (typeof value !== 'string')
							finish(new Error('Invalid Java evaluation result'));
						else finish(undefined, value);
					},
					(error) => finish(error instanceof Error ? error : new Error(String(error)))
				);
		});
	}

	private assertPaused() {
		if (this.closed) throw new Error('Java debugger stopped');
		if (this.stopId === undefined)
			throw new Error('Java debugger request requires a paused snapshot');
	}

	private assertCurrent(generation: number) {
		this.assertPaused();
		if (this.generation !== generation) throw new Error('Java debugger response became stale');
	}

	private request(
		op: 'scopes' | 'variables' | 'context',
		arguments_: Record<string, number>,
		signal?: AbortSignal
	): Promise<unknown> {
		this.assertPaused();
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (this.pending.size >= MAX_PENDING_REQUESTS)
			return Promise.reject(new Error('Java debugger request queue is full'));
		const stopId = this.stopId!;
		const id = ++this.nextRequest;
		return new Promise((resolve, reject) => {
			const finish = (error: Error) => {
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id);
				pending.cleanup();
				reject(error);
			};
			const aborted = () =>
				finish(signal?.reason ?? new Error('Java debugger request cancelled'));
			const timer = setTimeout(
				() => finish(new Error('Java debugger request timed out')),
				this.requestTimeoutMs
			);
			this.pending.set(id, {
				stopId,
				resolve,
				reject,
				cleanup() {
					clearTimeout(timer);
					signal?.removeEventListener('abort', aborted);
				}
			});
			signal?.addEventListener('abort', aborted, { once: true });
			try {
				this.mailbox.send(JSON.stringify({ op, id, stopId, ...arguments_ }));
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private validateVariables(value: unknown): asserts value is DebugVariable[] {
		if (
			!Array.isArray(value) ||
			value.length > MAX_VARIABLE_PAGE ||
			value.some(
				(variable) =>
					!variable ||
					typeof variable.name !== 'string' ||
					typeof variable.value !== 'string' ||
					(variable.variablesReference !== undefined &&
						variable.variablesReference !== 0 &&
						!validId(variable.variablesReference))
			)
		)
			throw new Error('Invalid Java debugger variables response');
	}

	private rememberVariables(variables: DebugVariable[]) {
		for (const variable of variables) {
			if (validId(variable.variablesReference))
				this.references.add(variable.variablesReference);
		}
	}

	private cancelEvaluations(error: Error) {
		for (const evaluation of this.evaluations) evaluation.cancel(error);
	}

	private invalidate(error: Error) {
		this.generation++;
		this.selectionVersion++;
		this.selectingFrame = false;
		this.stopId = undefined;
		this.frameId = undefined;
		this.frames.clear();
		this.references.clear();
		this.cancelEvaluations(error);
		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(error);
		}
		this.pending.clear();
	}

	dispose() {
		if (this.closed) return;
		this.closed = true;
		this.mailbox.close();
		this.invalidate(new Error('Java debugger stopped'));
		try {
			this.emit({ type: 'stop' });
		} catch {
			/* Mandatory cleanup precedes caller notifications. */
		}
	}
}
