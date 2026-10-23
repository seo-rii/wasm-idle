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
		scopes: []
	});
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
