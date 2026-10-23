// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { JavaDebugSession, type JavaDebugSessionOptions } from './javaDebug';
import { readDebugCommand } from './debugMailbox';
import type { DebugScope, DebugSessionEvent } from './options';

const sessions: JavaDebugSession[] = [];
const context = { bindings: [{ name: 'value', type: 'int', value: '7' }] };

function createSession(options: JavaDebugSessionOptions = {}) {
	const session = new JavaDebugSession('Main.java', () => {}, options);
	sessions.push(session);
	return session;
}

function scopes(stopId = 1): DebugScope[] {
	return [
		{
			name: 'Locals',
			variablesReference: stopId * 1000 + 1,
			namedVariables: 2,
			expensive: false,
			variables: [
				{ name: 'value', value: '7', type: 'int' },
				{
					name: 'items',
					value: 'Item[3]',
					type: 'Item[]',
					variablesReference: stopId * 1000 + 2,
					indexedVariables: 3
				}
			]
		}
	];
}

function pause(session: JavaDebugSession, stopId = 1) {
	const event: DebugSessionEvent = {
		type: 'pause',
		reason: 'breakpoint',
		line: 3,
		frameId: stopId * 100 + 1,
		locals: scopes(stopId)[0].variables,
		scopes: scopes(stopId),
		callStack: [
			{ id: stopId * 100 + 1, functionName: 'Main.work', line: 3, sourcePath: 'Main.java' },
			{ id: stopId * 100 + 2, functionName: 'Main.main', line: 9, sourcePath: 'Main.java' }
		]
	};
	session.handle({ stopId, event });
}

function receive(session: JavaDebugSession) {
	const buffer = session.mailbox.buffer;
	if (!(buffer instanceof SharedArrayBuffer)) throw new Error('SharedArrayBuffer unavailable');
	const command = readDebugCommand(
		buffer,
		false,
		() => session.handle({ consumed: true }),
		'Java'
	);
	expect(command).toBeTruthy();
	return JSON.parse(command!);
}

function respond(
	session: JavaDebugSession,
	request: { id: number; stopId: number },
	value: unknown
) {
	session.handle({ response: { id: request.id, stopId: request.stopId, value } });
}

afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
	vi.useRealTimers();
});

it('closes and wakes the command mailbox even when the stop listener throws', () => {
	const session = new JavaDebugSession('Main.java', () => {
		throw new Error('listener');
	});
	const buffer = session.mailbox.buffer;
	if (!(buffer instanceof SharedArrayBuffer)) throw new Error('SharedArrayBuffer unavailable');
	session.command('nextLine');
	expect(JSON.parse(readDebugCommand(buffer, true, () => {}, 'Java')!)).toEqual({
		op: 'control',
		command: 'nextLine'
	});
	expect(() => session.dispose()).not.toThrow();
	expect(readDebugCommand(buffer, false, () => {}, 'Java')).toBeNull();
	expect(() => session.command('continue')).toThrow('closed');
	expect(() => session.dispose()).not.toThrow();
});

it('routes scoped variable pages and registers expandable children from real replies', async () => {
	const session = createSession();
	pause(session);
	const loadedScopes = session.scopes(101);
	const scopeRequest = receive(session);
	expect(scopeRequest).toEqual({ op: 'scopes', id: 1, stopId: 1, frameId: 101 });
	respond(session, scopeRequest, scopes());
	await expect(loadedScopes).resolves.toEqual(scopes());
	const page = session.variables(1002, 1, 1);
	const request = receive(session);
	expect(request).toEqual({
		op: 'variables',
		id: 2,
		stopId: 1,
		reference: 1002,
		start: 1,
		count: 1
	});
	const item = { name: '[1]', value: 'Item', variablesReference: 1003, namedVariables: 1 };
	respond(session, request, [item]);
	await expect(page).resolves.toEqual([item]);
	const children = session.variables(1003);
	respond(session, receive(session), [{ name: 'value', value: '9', type: 'int' }]);
	await expect(children).resolves.toEqual([{ name: 'value', value: '9', type: 'int' }]);
});

it('evaluates an explicit selected frame and leaves selection unchanged for read-only scopes', async () => {
	const evaluate = vi.fn(async () => '11');
	const session = createSession({ evaluate });
	pause(session);
	const selected = session.scopes(102);
	respond(session, receive(session), []);
	await selected;
	const readOnly = session.scopes(101, false);
	respond(session, receive(session), scopes());
	await readOnly;
	const unavailable = session.evaluate('value');
	const unavailableResult = expect(unavailable).rejects.toThrow('No captured environment');
	const request = receive(session);
	expect(request).toMatchObject({ op: 'context', stopId: 1, frameId: 102 });
	session.handle({
		response: { id: request.id, stopId: 1, error: 'No captured environment for caller frame' }
	});
	await unavailableResult;
	expect(evaluate).not.toHaveBeenCalled();
	const top = session.scopes(101);
	respond(session, receive(session), scopes());
	await top;
	const value = session.evaluate('value + 4');
	respond(session, receive(session), context);
	await expect(value).resolves.toBe('11');
	expect(evaluate).toHaveBeenCalledWith('value + 4', context, expect.any(AbortSignal));
});

it('preserves unavailable values separately from an actual null String in evaluation context', async () => {
	const evaluate = vi.fn<NonNullable<JavaDebugSessionOptions['evaluate']>>(async () => 'null');
	const session = createSession({ evaluate });
	pause(session);
	const snapshot = {
		bindings: [
			{ name: 'text', type: 'java.lang.String', value: null },
			{
				name: 'items',
				type: 'int[]',
				value: null,
				unavailable: 'Reference values cannot enter the evaluator'
			},
			{
				name: 'large',
				type: 'java.lang.String',
				value: null,
				unavailable: 'String exceeds the capture limit'
			}
		]
	};
	const value = session.evaluate('text');
	respond(session, receive(session), snapshot);
	await expect(value).resolves.toBe('null');
	expect(evaluate).toHaveBeenCalledWith('text', snapshot, expect.any(AbortSignal));
	expect(evaluate.mock.calls[0][1]).not.toBe(snapshot);
});

it('keeps the last selected frame when scope replies arrive in reverse order', async () => {
	const session = createSession({ evaluate: async () => '7' });
	pause(session);
	const caller = session.scopes(102);
	const staleCaller = expect(caller).rejects.toThrow('selection became stale');
	const callerRequest = receive(session);
	const top = session.scopes(101);
	const topRequest = receive(session);
	await expect(session.evaluate('value')).rejects.toThrow('selected paused frame');
	respond(session, topRequest, scopes());
	await top;
	respond(session, callerRequest, []);
	await staleCaller;
	const value = session.evaluate('value');
	const request = receive(session);
	expect(request.frameId).toBe(101);
	respond(session, request, context);
	await expect(value).resolves.toBe('7');
});

it('rejects old handles and ignores late or wrong-stop replies after resume', async () => {
	const session = createSession();
	pause(session);
	const old = session.variables(1002);
	const rejected = expect(old).rejects.toThrow('stale');
	const oldRequest = receive(session);
	session.handle({ event: { type: 'resume', command: 'continue' } });
	await rejected;
	respond(session, oldRequest, [{ name: '[0]', value: 'old' }]);
	pause(session, 2);
	await expect(session.variables(1002)).rejects.toThrow('stale');
	await expect(session.scopes(101)).rejects.toThrow('stale');
	const current = session.variables(2002);
	const currentRequest = receive(session);
	respond(session, { ...currentRequest, stopId: 1 }, [{ name: '[0]', value: 'wrong stop' }]);
	respond(session, currentRequest, [{ name: '[0]', value: 'current' }]);
	await expect(current).resolves.toEqual([{ name: '[0]', value: 'current' }]);
});

it.each(['control', 'resume', 'pause', 'dispose'] as const)(
	'aborts an active sidecar evaluation on %s and ignores its late completion',
	async (action) => {
		let complete!: (value: string) => void;
		let signal!: AbortSignal;
		const evaluate = vi.fn((_expression, _context, receivedSignal: AbortSignal) => {
			signal = receivedSignal;
			return new Promise<string>((resolve) => {
				complete = resolve;
			});
		});
		const session = createSession({ evaluate });
		pause(session);
		const value = session.evaluate('value + 4');
		const rejected = expect(value).rejects.toThrow(/stale|stopped/);
		respond(session, receive(session), context);
		await Promise.resolve();
		expect(evaluate).toHaveBeenCalledOnce();
		if (action === 'control') session.command('nextLine');
		else if (action === 'resume')
			session.handle({ event: { type: 'resume', command: 'continue' } });
		else if (action === 'pause') pause(session, 2);
		else session.dispose();
		await rejected;
		expect(signal.aborted).toBe(true);
		complete('late result');
		await Promise.resolve();
	}
);

it('cancels evaluation when frame selection starts without changing target execution', async () => {
	let signal!: AbortSignal;
	const session = createSession({
		evaluate: async (_expression, _context, receivedSignal) => {
			signal = receivedSignal;
			return await new Promise<string>(() => {});
		}
	});
	pause(session);
	const value = session.evaluate('value');
	const rejected = expect(value).rejects.toThrow('frame selection');
	respond(session, receive(session), context);
	await Promise.resolve();
	const selection = session.scopes(102);
	const request = receive(session);
	expect(request.op).toBe('scopes');
	await rejected;
	expect(signal.aborted).toBe(true);
	respond(session, request, []);
	await expect(selection).resolves.toEqual([]);
});

it('does not start an evaluator after a context reply was invalidated before its promise callback', async () => {
	const evaluate = vi.fn(async () => 'late');
	const session = createSession({ evaluate });
	pause(session);
	const value = session.evaluate('value');
	const rejected = expect(value).rejects.toThrow('stale');
	respond(session, receive(session), context);
	session.command('continue');
	await rejected;
	expect(evaluate).not.toHaveBeenCalled();
});

it('times out transport requests and releases timers without closing the target mailbox', async () => {
	vi.useFakeTimers();
	const session = createSession();
	pause(session);
	const value = session.variables(1002);
	const rejected = expect(value).rejects.toThrow('request timed out');
	const request = receive(session);
	await vi.advanceTimersByTimeAsync(10_000);
	await rejected;
	expect(vi.getTimerCount()).toBe(0);
	respond(session, request, []);
	const next = session.variables(1002);
	respond(session, receive(session), []);
	await expect(next).resolves.toEqual([]);
});

it('does not start an evaluator when its context transport times out', async () => {
	vi.useFakeTimers();
	const evaluate = vi.fn(async () => 'unexpected');
	const session = createSession({ evaluate });
	pause(session);
	const value = session.evaluate('value');
	const rejected = expect(value).rejects.toThrow('request timed out');
	const request = receive(session);
	await vi.advanceTimersByTimeAsync(10_000);
	await rejected;
	expect(vi.getTimerCount()).toBe(0);
	respond(session, request, context);
	await Promise.resolve();
	expect(evaluate).not.toHaveBeenCalled();
});

it('aborts the evaluator at its own timeout and keeps target queries available', async () => {
	vi.useFakeTimers();
	let signal!: AbortSignal;
	const session = createSession({
		evaluate: async (_expression, _context, receivedSignal) => {
			signal = receivedSignal;
			return await new Promise<string>(() => {});
		}
	});
	pause(session);
	const value = session.evaluate('value');
	const rejected = expect(value).rejects.toThrow('evaluation timed out');
	respond(session, receive(session), context);
	await Promise.resolve();
	await vi.advanceTimersByTimeAsync(45_000);
	await rejected;
	expect(signal.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
	const next = session.scopes(101, false);
	respond(session, receive(session), scopes());
	await expect(next).resolves.toEqual(scopes());
});

it('bounds pending requests and clears every timer and rejection on disposal', async () => {
	vi.useFakeTimers();
	const session = createSession();
	pause(session);
	const requests = Array.from({ length: 64 }, () => session.scopes(101, false));
	const settled = Promise.allSettled(requests);
	await expect(session.scopes(101, false)).rejects.toThrow('queue is full');
	expect(vi.getTimerCount()).toBe(64);
	session.dispose();
	expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it('rejects unsupported or malformed requests before publishing commands', async () => {
	const session = createSession();
	await expect(session.evaluate('1 + 1')).rejects.toThrow('unavailable');
	await expect(session.scopes(101)).rejects.toThrow('paused snapshot');
	pause(session);
	await expect(session.evaluate('x'.repeat(4097))).rejects.toThrow('4096');
	await expect(session.variables(1002, -1, 50)).rejects.toThrow('page');
	await expect(session.variables(1002, 0, 1001)).rejects.toThrow('page');
	await expect(session.variables(9999)).rejects.toThrow('stale');
	const buffer = session.mailbox.buffer as SharedArrayBuffer;
	expect(readDebugCommand(buffer, false, () => {}, 'Java')).toBe('');
});

it('rejects malformed response values without registering their handles or starting evaluation', async () => {
	const evaluate = vi.fn(async () => 'wrong');
	const session = createSession({ evaluate });
	pause(session);
	const variables = session.variables(1002, 0, 1);
	const invalidVariables = expect(variables).rejects.toThrow('variables response');
	respond(session, receive(session), [{ name: 'bad', value: {}, variablesReference: 9999 }]);
	await invalidVariables;
	await expect(session.variables(9999)).rejects.toThrow('stale');
	const result = session.evaluate('value');
	const invalidContext = expect(result).rejects.toThrow('evaluation context');
	respond(session, receive(session), { bindings: [{ name: 'value', type: 'int', value: {} }] });
	await invalidContext;
	expect(evaluate).not.toHaveBeenCalled();
});

it('forwards legacy pause events while refusing unversioned value requests', async () => {
	const emit = vi.fn();
	const session = new JavaDebugSession('Main.java', emit);
	sessions.push(session);
	const event: DebugSessionEvent = {
		type: 'pause',
		reason: 'entry',
		line: 1,
		frameId: 1,
		locals: [],
		callStack: []
	};
	session.handle({ event });
	expect(emit).toHaveBeenCalledWith(event);
	await expect(session.scopes(1)).rejects.toThrow('paused snapshot');
	session.command('continue');
	expect(receive(session)).toEqual({ op: 'control', command: 'continue' });
});
