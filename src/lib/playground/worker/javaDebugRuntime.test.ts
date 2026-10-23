// @vitest-environment node
import { expect, it } from 'vitest';
import { createJavaDebugRuntime, type JavaDebugFile } from './javaDebugRuntime';
import type { DebugSessionEvent } from '../options';

const files: JavaDebugFile[] = ['Main.java', 'Helper.java'].map((path) => ({
	path,
	sourceContentSha256: 'a'.repeat(64),
	lineCount: 20,
	locations: [2, 3, 4, 5].map((line) => ({ line, column: 3 }))
}));
const stack = (name: string, line: number) =>
	JSON.stringify([[name, 'call', `${name}.java`, line]]);

it('maps auxiliary workspace paths and verifies only actual hook locations', () => {
	const events: DebugSessionEvent[] = [];
	const runtime = createJavaDebugRuntime(
		files,
		{
			activePath: 'Main.java',
			debugPath: '/workspace/Main.java',
			breakpoints: [],
			sourceBreakpoints: [{ sourcePath: '/workspace/Helper.java', lines: [3, 19] }],
			pauseOnEntry: false
		},
		(event) => events.push(event),
		(blocking) => (blocking ? '{"op":"control","command":"continue"}' : '')
	);
	expect(events[1]).toMatchObject({
		type: 'breakpoints',
		sourcePath: '/workspace/Helper.java',
		breakpoints: [
			{ line: 3, verified: true },
			{ line: 19, verified: false }
		]
	});
	expect(runtime.poll('Helper.java', 3, 3)).not.toBeNull();
	runtime.pause('Helper.java', 3, 3, stack('Helper', 3), 2);
	expect(events.find((event) => event.type === 'pause')).toMatchObject({
		sourcePath: '/workspace/Helper.java',
		callStack: [{ sourcePath: '/workspace/Helper.java' }],
		locals: [],
		scopes: [{ name: 'Locals', variables: [], namedVariables: 0 }]
	});
});

it('services Java-owned value queries and never reuses handles from an earlier pause', () => {
	const events: DebugSessionEvent[] = [];
	const replies: any[] = [];
	const queued: object[] = [
		{ op: 'scopes', id: 1, stopId: 1, frameId: 101 },
		{ op: 'variables', id: 2, stopId: 1, reference: 100002, start: 1, count: 1 },
		{ op: 'context', id: 3, stopId: 1, frameId: 101 },
		{ op: 'control', command: 'nextLine' }
	];
	const runtime = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: true },
		(event) => events.push(event),
		(blocking) =>
			blocking
				? JSON.stringify(queued.shift() ?? { op: 'control', command: 'continue' })
				: '',
		(response) => replies.push(response)
	);
	const locals = JSON.stringify([
		{
			name: 'array',
			value: 'int[] (2)',
			type: 'int[]',
			variablesReference: 1,
			indexedVariables: 2
		}
	]);
	expect(runtime.pause('Main.java', 2, 3, stack('Main', 2), 2, locals, 1)).toEqual({
		op: 'variables',
		id: 2,
		stopId: 1,
		reference: 1,
		start: 1,
		count: 1
	});
	expect(replies[0]).toMatchObject({
		id: 1,
		stopId: 1,
		value: [{ variablesReference: 100001, variables: [{ variablesReference: 100002 }] }]
	});
	expect(
		runtime.reply(
			2,
			1,
			JSON.stringify([{ name: '[1]', value: '7', type: 'int', variablesReference: 0 }]),
			null
		)
	).toEqual({ op: 'context', id: 3, stopId: 1 });
	expect(replies[1]).toMatchObject({ id: 2, value: [{ name: '[1]', value: '7' }] });
	expect(
		runtime.reply(
			3,
			1,
			'{"bindings":[{"name":"large","type":"long","value":"9007199254740993"}]}',
			null
		)
	).toBeNull();
	expect(replies[2]).toMatchObject({
		id: 3,
		value: { bindings: [{ value: '9007199254740993' }] }
	});
	queued.push(
		{ op: 'variables', id: 4, stopId: 1, reference: 100002 },
		{ op: 'variables', id: 5, stopId: 2, reference: 100002 },
		{ op: 'context', id: 6, stopId: 2, frameId: 999 },
		{ op: 'variables', id: 7, stopId: 2, reference: 200002, start: 0, count: 0 },
		{ op: 'control', command: 'continue' }
	);
	expect(runtime.pause('Main.java', 3, 3, stack('Main', 3), 2, locals, 1)).toEqual({
		op: 'variables',
		id: 7,
		stopId: 2,
		reference: 1,
		start: 0,
		count: 0
	});
	expect(replies.slice(3).map((reply) => reply.error)).toEqual([
		expect.stringMatching(/earlier stop/),
		expect.stringMatching(/stale/),
		expect.stringMatching(/currently stopped frame/)
	]);
	expect(runtime.reply(7, 2, '[]', null)).toBeNull();
	expect(() => runtime.reply(2, 1, '[]', null)).toThrow(/earlier request/);
	expect(
		events
			.filter((event) => event.type === 'pause')
			.map((event) => event.scopes?.[0].variablesReference)
	).toEqual([100001, 200001]);
});

it('keeps the target paused after an inspection error and rejects bad pages', () => {
	const replies: any[] = [];
	const queued = [
		{ op: 'variables', id: 1, stopId: 1, reference: 100001, count: 1001 },
		{ op: 'context', id: 2, stopId: 1, frameId: 101 },
		{ op: 'scopes', id: 3, stopId: 1, frameId: 101 },
		{ op: 'control', command: 'continue' }
	];
	const runtime = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: true },
		() => {},
		(blocking) => (blocking ? JSON.stringify(queued.shift()) : ''),
		(response) => replies.push(response)
	);
	expect(runtime.pause('Main.java', 2, 3, stack('Main', 2), 1)).toMatchObject({
		op: 'context',
		id: 2
	});
	expect(runtime.reply(2, 1, null, 'Value could not be inspected')).toBeNull();
	expect(replies).toEqual([
		{ id: 1, stopId: 1, error: expect.stringMatching(/page/) },
		{ id: 2, stopId: 1, error: 'Value could not be inspected' },
		{ id: 3, stopId: 1, value: [expect.objectContaining({ name: 'Locals' })] }
	]);
});

it('uses full Java depth for next and out beyond the 64 displayed frames, and skips same-line callbacks', () => {
	const events: DebugSessionEvent[] = [];
	const commands = ['nextLine', 'stepOut', 'continue'];
	const runtime = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: true },
		(event) => events.push(event),
		(blocking) => (blocking ? JSON.stringify({ op: 'control', command: commands.shift() }) : '')
	);
	const hit = (line: number, depth: number, column = 3) =>
		runtime.pause('Main.java', line, column, stack('Main', line), depth);
	hit(2, 100);
	hit(3, 101); // called function has a deeper genuine Java stack
	hit(2, 100, 7); // another statement on the same source line
	expect(events.filter((event) => event.type === 'pause')).toHaveLength(1);
	hit(3, 100);
	hit(4, 100);
	expect(events.filter((event) => event.type === 'pause')).toHaveLength(2);
	hit(5, 99);
	expect(events.filter((event) => event.type === 'pause').map((event) => event.line)).toEqual([
		2, 3, 5
	]);
});

it('honors asynchronous pause and closed mailboxes without fabricating frames', () => {
	const events: DebugSessionEvent[] = [];
	const queued = ['{"op":"pause"}', ''];
	const runtime = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: false },
		(event) => events.push(event),
		(blocking) => (blocking ? '{"op":"control","command":"continue"}' : (queued.shift() ?? ''))
	);
	expect(runtime.poll('Main.java', 3, 3)).not.toBeNull();
	runtime.pause('Main.java', 3, 3, stack('Main', 3), 3);
	expect(events.find((event) => event.type === 'pause')).toMatchObject({ reason: 'pause' });
	expect(() => runtime.pause('Main.java', 3, 3, '[]', 1)).toThrow('could not provide');
	const closed = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: false },
		() => {},
		() => null
	);
	expect(() => closed.poll('Main.java', 3, 3)).toThrow('stopped');
});

it('next can pause on a repeated loop position even when its source line does not change', () => {
	const events: DebugSessionEvent[] = [];
	const commands = ['nextLine', 'continue'];
	const runtime = createJavaDebugRuntime(
		files,
		{ activePath: 'Main.java', breakpoints: [], pauseOnEntry: true },
		(event) => events.push(event),
		(blocking) => (blocking ? JSON.stringify({ op: 'control', command: commands.shift() }) : '')
	);
	runtime.pause('Main.java', 3, 7, stack('Main', 3), 5);
	runtime.pause('Main.java', 3, 11, stack('Main', 3), 5);
	expect(events.filter((event) => event.type === 'pause')).toHaveLength(1);
	runtime.pause('Main.java', 3, 7, stack('Main', 3), 5);
	expect(events.filter((event) => event.type === 'pause')).toHaveLength(2);
});
