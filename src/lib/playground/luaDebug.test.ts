import { describe, expect, it, vi } from 'vitest';
import { LuaDebugMailbox, readLuaDebugCommand } from './luaDebug';

describe('Lua debugger Worker mailbox', () => {
	it('publishes queued UTF-8 commands in order and closes a blocked consumer', () => {
		const mailbox = new LuaDebugMailbox();
		const consumed = vi.fn(() => mailbox.flush());
		mailbox.send('EXEC return ("한글")\n');
		mailbox.send('OVER\n');
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, false, consumed)).toBe(
			'EXEC return ("한글")\n'
		);
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, false, consumed)).toBe(
			'OVER\n'
		);
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, false, consumed)).toBe('');
		mailbox.close();
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, true, consumed)).toBeNull();
		expect(() => mailbox.send('RUN\n')).toThrow('closed');
		mailbox.reset();
		mailbox.send('RUN\n');
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, false, consumed)).toBe(
			'RUN\n'
		);
	});

	it('rejects oversized messages before changing the published command', () => {
		const mailbox = new LuaDebugMailbox();
		mailbox.send('STEP\n');
		expect(() => mailbox.send('x'.repeat(65_537))).toThrow(RangeError);
		expect(readLuaDebugCommand(mailbox.buffer as SharedArrayBuffer, false, () => {})).toBe(
			'STEP\n'
		);
	});
});
