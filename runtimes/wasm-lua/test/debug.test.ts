import { describe, expect, it } from 'vitest';
import { compileLua, executeBrowserLuaArtifact, type LuaDebugEvent } from '../src/index';

describe('MobDebug on the real Lua VM', () => {
	it.each(['"requestId=999"', '"--{requestId=999}"'])(
		'keeps request metadata separate from expression %s',
		async (expression) => {
			const compiled = await compileLua({ code: 'print(7)', fileName: 'literal.lua' });
			const commands: string[] = [];
			const events: LuaDebugEvent[] = [];
			const result = await executeBrowserLuaArtifact(compiled.artifact!, {
				debug: {
					readCommand: (blocking) => commands.shift() ?? (blocking ? null : ''),
					onEvent: (event) => {
						events.push(event);
						commands.push(
							event.type === 'pause'
								? `EXEC return (${expression}) --{requestId=1}\n`
								: 'RUN\n'
						);
					}
				}
			});
			expect(result.stderr).toBe('');
			expect(result.stdout).toBe('7\n');
			expect(events[1]).toMatchObject({ type: 'evaluate', id: 1, value: expression });
		}
	);

	it('stops at a source breakpoint, reads real frames and evaluates a local with stdin/stdout', async () => {
		const source = [
			'local function twice(value)',
			'  local result = value * 2',
			'  return result',
			'end',
			'local n = tonumber(io.read("*l"))',
			'local total = twice(n)',
			'print(total)'
		].join('\n');
		const compiled = await compileLua({ code: source, fileName: 'example.lua' });
		expect(compiled.success).toBe(true);
		const events: LuaDebugEvent[] = [];
		const commands: string[] = [];
		const result = await executeBrowserLuaArtifact(compiled.artifact!, {
			stdin: () => '6\n',
			debug: {
				pauseOnEntry: false,
				breakpoints: [3],
				readCommand: (blocking) => {
					const command = commands.shift();
					if (command !== undefined) return command;
					if (!blocking) return '';
					throw new Error('Unexpected blocking debugger read');
				},
				onEvent: (event) => {
					events.push(event);
					if (event.type === 'pause') {
						commands.push(
							'EXEC return (result + 1) --{stack=1,requestId=1,metatostring=false}\n'
						);
					} else {
						commands.push('RUN\n');
					}
				}
			}
		});
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('12\n');
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: 'pause',
			line: 3,
			sourcePath: 'example.lua',
			reason: 'breakpoint'
		});
		const pause = events[0];
		if (pause.type !== 'pause') throw new Error('Expected a real source stop');
		expect(pause.frames[0]).toMatchObject({ sourcePath: 'example.lua', line: 3 });
		expect(pause.frames[0].locals).toContainEqual({
			name: 'result',
			value: '12',
			type: 'number'
		});
		expect(pause.frames[0].locals).toContainEqual({
			name: 'value',
			value: '6',
			type: 'number'
		});
		expect(pause.frames.length).toBeGreaterThan(1);
		expect(events[1]).toMatchObject({ type: 'evaluate', id: 1, value: '13' });
	});

	it('uses MobDebug step into, over and out without changing recursive source', async () => {
		const source = [
			'local function sum(n)',
			'  if n == 0 then return 0 end',
			'  local rest = sum(n - 1)',
			'  return rest + n',
			'end',
			'local total = sum(2)',
			'print(total)'
		].join('\n');
		const compiled = await compileLua({ code: source, fileName: 'recursive.lua' });
		const pauses: Extract<LuaDebugEvent, { type: 'pause' }>[] = [];
		const sequence = ['OVER\n', 'STEP\n', 'OVER\n', 'OUT\n', 'RUN\n'];
		const commands: string[] = [];
		const result = await executeBrowserLuaArtifact(compiled.artifact!, {
			debug: {
				readCommand: (blocking) => commands.shift() ?? (blocking ? null : ''),
				onEvent: (event) => {
					if (event.type !== 'pause') return;
					pauses.push(event);
					commands.push(sequence.shift() ?? 'RUN\n');
				}
			}
		});
		expect(result.stderr).toBe('');
		expect(result.stdout).toBe('3\n');
		expect(pauses.map((pause) => pause.line)).toEqual([5, 6, 2, 3, 7]);
		expect(pauses[0].reason).toBe('entry');
		expect(pauses[2].frames[0].locals).toContainEqual({
			name: 'n',
			type: 'number',
			value: '2'
		});
	});
});
