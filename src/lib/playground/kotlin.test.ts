import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_CHEERPJ_LOADER_URL: '',
		PUBLIC_WASM_KOTLIN_VIRTUAL_BASE_PATH: ''
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Kotlin, { parseKotlinDiagnostics } from './kotlin';

const virtualFiles = new Map<string, string>();
const cheerpJRunMainCalls: any[][] = [];

function installCheerpJMock() {
	(globalThis as any).cheerpjInit = vi.fn(async () => {});
	(globalThis as any).cheerpOSAddStringFile = vi.fn(async (path: string, content: string) => {
		virtualFiles.set(path, String(content));
	});
	(globalThis as any).cjFileBlob = vi.fn(async (path: string) => {
		return new Blob([virtualFiles.get(path) || ''], { type: 'text/plain;charset=utf-8' });
	});
	(globalThis as any).cheerpjRunMain = vi.fn(async (...call: any[]) => {
		cheerpJRunMainCalls.push(call);
		const mode = call[2];
		if (mode === 'compile') {
			const sourcePath = call[3];
			const workDir = call[6];
			const source = virtualFiles.get(sourcePath) || '';
			virtualFiles.set(`${workDir}/compile.stdout.txt`, '');
			virtualFiles.set(`${workDir}/compile.stderr.txt`, '');
			virtualFiles.set(`${workDir}/compile.status.txt`, source.includes('nope') ? '1' : '0');
			virtualFiles.set(`${workDir}/main-class.txt`, 'MainKt\n');
			if (source.includes('nope')) {
				virtualFiles.set(
					`${workDir}/compile.stderr.txt`,
					`${sourcePath}:2:5: error: unresolved reference 'nope'\n`
				);
			}
			return 0;
		}
		if (mode === 'run') {
			const stdinPath = call[6];
			const workDir = call[7];
			const args = call.slice(8);
			virtualFiles.set(
				`${workDir}/run.stdout.txt`,
				`args=${args.join(',')}\nstdin=${virtualFiles.get(stdinPath) || ''}`
			);
			virtualFiles.set(`${workDir}/run.stderr.txt`, '');
			virtualFiles.set(`${workDir}/run.status.txt`, '0');
			return 0;
		}
		return 1;
	});
}

describe('Kotlin sandbox', () => {
	beforeEach(() => {
		virtualFiles.clear();
		cheerpJRunMainCalls.length = 0;
		installCheerpJMock();
	});

	it('compiles with kotlinc on the CheerpJ classpath and runs the detected main class', async () => {
		const sandbox = new Kotlin();
		const outputs: string[] = [];
		const progressValues: number[] = [];
		const code = `fun main(args: Array<String>) {
    println(args.joinToString(","))
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load(
			{
				rootUrl: '/absproxy/5173',
				kotlin: {
					cheerpjLoaderUrl: '/cheerpj/loader.js'
				}
			},
			code,
			true,
			[],
			{},
			{ set: (value) => progressValues.push(value) }
		);
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'src/Main.kt',
				compileArgs: ['-language-version', '2.3']
			})
		).resolves.toBe(true);
		sandbox.write('5\n');
		await expect(
			sandbox.run(code, false, true, undefined, ['one', 'two'], {
				activePath: 'src/Main.kt',
				compileArgs: ['-language-version', '2.3']
			})
		).resolves.toBe(true);

		expect((globalThis as any).cheerpjInit).toHaveBeenCalledWith({ version: 8 });
		expect(progressValues).toContain(1);
		expect(cheerpJRunMainCalls[0]).toEqual([
			'org.wasmidle.kotlin.Bridge',
			expect.stringContaining('/app/absproxy/5173/wasm-kotlin/wasm-idle-kotlin-bridge.jar'),
			'compile',
			expect.stringMatching(/^\/str\/wasm-idle-kotlin-.+-Main\.kt$/),
			expect.stringMatching(/^\/files\/wasm-idle-kotlin\/.+\/classes$/),
			'/app/absproxy/5173/wasm-kotlin/kotlin-stdlib-2.3.21.jar',
			expect.stringMatching(/^\/files\/wasm-idle-kotlin\/.+$/),
			'-language-version',
			'2.3'
		]);
		expect(cheerpJRunMainCalls[0][1]).toContain('kotlin-compiler-embeddable-2.3.21.jar');
		expect(cheerpJRunMainCalls[1]).toEqual([
			'org.wasmidle.kotlin.Bridge',
			cheerpJRunMainCalls[0][1],
			'run',
			cheerpJRunMainCalls[0][4],
			'MainKt',
			'/app/absproxy/5173/wasm-kotlin/kotlin-stdlib-2.3.21.jar',
			expect.stringMatching(/^\/str\/wasm-idle-kotlin-stdin-.+\.txt$/),
			expect.stringMatching(/^\/files\/wasm-idle-kotlin\/.+$/),
			'one',
			'two'
		]);
		expect(outputs.join('')).toContain('kotlinc Main.kt');
		expect(outputs.join('')).toContain('args=one,two\nstdin=5\n');
	});

	it('parses kotlinc diagnostics and rejects failed compilations', async () => {
		const sandbox = new Kotlin();
		const diagnostics: any[] = [];

		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);
		await sandbox.load({
			kotlin: {
				cheerpjLoaderUrl: '/cheerpj/loader.js',
				virtualBasePath: '/app/wasm-kotlin/'
			}
		});

		await expect(
			sandbox.run('fun main() {\n    nope\n}', true, true, undefined, [], {
				activePath: 'Broken.kt'
			})
		).rejects.toContain("unresolved reference 'nope'");
		expect(diagnostics).toEqual([
			{
				fileName: 'Broken.kt',
				lineNumber: 2,
				columnNumber: 5,
				severity: 'error',
				message: "unresolved reference 'nope'"
			}
		]);
	});

	it('waits for terminal input before running code that reads from stdin', async () => {
		const sandbox = new Kotlin();
		const code = `fun main() {
    println(readlnOrNull())
}`;

		await sandbox.load({
			kotlin: {
				cheerpjLoaderUrl: '/cheerpj/loader.js',
				virtualBasePath: '/app/wasm-kotlin/'
			}
		});
		await sandbox.run(code, true, true, undefined, [], { activePath: 'Main.kt' });
		const running = sandbox.run(code, false, true, undefined, [], {
			activePath: 'Main.kt'
		});
		await Promise.resolve();

		expect(cheerpJRunMainCalls).toHaveLength(1);
		sandbox.write('9\n');
		await expect(running).resolves.toBe(true);
		expect(cheerpJRunMainCalls).toHaveLength(2);
	});

	it('parses classic and K2-style source diagnostics', () => {
		expect(
			parseKotlinDiagnostics(
				'/str/wasm-idle-kotlin-abc-Main.kt',
				'Main.kt',
				"/str/wasm-idle-kotlin-abc-Main.kt:7:3: warning: variable 'x' is never used\n"
			)
		).toEqual([
			{
				fileName: 'Main.kt',
				lineNumber: 7,
				columnNumber: 3,
				severity: 'warning',
				message: "variable 'x' is never used"
			}
		]);

		expect(
			parseKotlinDiagnostics(
				'/str/wasm-idle-kotlin-def-Main.kt',
				'Main.kt',
				'e: file:///str/wasm-idle-kotlin-def-Main.kt: (4, 9): Unresolved reference: nope\n'
			)
		).toEqual([
			{
				fileName: 'Main.kt',
				lineNumber: 4,
				columnNumber: 9,
				severity: 'error',
				message: 'Unresolved reference: nope'
			}
		]);
	});
});
