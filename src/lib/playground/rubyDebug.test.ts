import { expect, it } from 'vitest';
import { RubyDebugSession } from './rubyDebug';
import { readDebugCommand } from './debugMailbox';

it('invalidates paused Ruby values on resume and releases pending requests despite a throwing stop callback', async () => {
	const session = new RubyDebugSession('main.rb', (event) => {
		if (event.type === 'stop') throw new Error('Caller failed');
	});
	const pause = {
		event: { type: 'pause', frameId: 1001 },
		frames: [{ id: 1001, locals: [{ name: 'value', value: '7' }] }]
	};
	session.handle(pause);
	expect(session.variables(1001)).toEqual([{ name: 'value', value: '7' }]);
	const stale = session.evaluate('value');
	const staleResult = expect(stale).rejects.toThrow('stale');
	session.handle({ event: { type: 'resume', command: 'continue' } });
	await staleResult;
	expect(session.variables(1001)).toEqual([]);
	session.handle(pause);
	const pending = session.evaluate('value');
	const stopped = expect(pending).rejects.toThrow('stopped');
	expect(() => session.dispose()).not.toThrow();
	await stopped;
	expect(
		readDebugCommand(
			session.mailbox.buffer as SharedArrayBuffer,
			false,
			() => undefined,
			'Ruby'
		)
	).toBeNull();
	session.dispose();
});

it('paginates Ruby frame snapshots and reports only the available local count', () => {
	const session = new RubyDebugSession('main.rb', () => undefined);
	const locals = Array.from({ length: 50 }, (_, index) => ({
		name: `local${index}`,
		value: String(index)
	}));
	session.handle({ event: { type: 'pause', frameId: 1001 }, frames: [{ id: 1001, locals }] });
	expect(session.scopes(1001)[0].namedVariables).toBe(50);
	expect(session.variables(1001, 45, 20)).toEqual(locals.slice(45));
	expect(session.variables(1001, 50, 50)).toEqual([]);
	expect(() => session.variables(1001, -1, 50)).toThrow('page');
	session.dispose();
});
