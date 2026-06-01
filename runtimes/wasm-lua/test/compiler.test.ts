import { describe, expect, it } from 'vitest';
import { compileLua, executeBrowserLuaArtifact } from '../src/index';

describe('wasm-lua browser runtime', () => {
	it('compiles and executes Lua source through wasmoon', async () => {
		const compileResult = await compileLua({
			code: `
local bonus = tonumber(arg[1] or "3")
local n = tonumber(io.read("*l") or "") or 4
local function factorial(value)
  if value <= 1 then
    return 1
  end
  return value * factorial(value - 1)
end
print("factorial_plus_bonus=" .. tostring(factorial(n) + bonus))
`,
			fileName: 'main.lua'
		});

		expect(compileResult.success).toBe(true);
		expect(compileResult.artifact).toBeTruthy();
		const execution = await executeBrowserLuaArtifact(compileResult.artifact!, {
			args: ['5'],
			stdin: () => '4\n'
		});

		expect(execution.exitCode).toBe(0);
		expect(execution.stdout).toContain('factorial_plus_bonus=29');
	});

	it('reports syntax diagnostics without executing the program', async () => {
		const result = await compileLua({
			code: `
local function broken()
  print("missing end")
`,
			fileName: 'broken.lua'
		});

		expect(result.success).toBe(false);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]).toMatchObject({
			fileName: 'broken.lua',
			severity: 'error'
		});
		expect(result.diagnostics[0].lineNumber).toBeGreaterThan(0);
		expect(result.stderr).toContain('end');
	});
});
