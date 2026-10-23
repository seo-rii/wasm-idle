// @vitest-environment node
import { expect, it } from 'vitest';
import { JavaDebugSession } from './javaDebug';
import { readDebugCommand } from './debugMailbox';

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
