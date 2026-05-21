import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_CHEERPJ_LOADER_URL: '',
		PUBLIC_WASM_SCALA_VIRTUAL_BASE_PATH: ''
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Scala, { parseScalaDiagnostics } from './scala';

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
			virtualFiles.set(`${workDir}/main-class.txt`, 'Main\n');
			if (source.includes('nope')) {
				virtualFiles.set(
					`${workDir}/compile.stderr.txt`,
					`${sourcePath}:2: error: not found: value nope\n    nope\n    ^\n`
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
				`stdin=${virtualFiles.get(stdinPath) || ''}`
			);
			virtualFiles.set(`${workDir}/run.stderr.txt`, '');
			virtualFiles.set(`${workDir}/run.status.txt`, `0`);
			virtualFiles.set(
				`${workDir}/run.stdout.txt`,
				`args=${args.join(',')}\nstdin=${virtualFiles.get(stdinPath) || ''}`
			);
			return 0;
		}
		return 1;
	});
}

describe('Scala sandbox', () => {
	beforeEach(() => {
		virtualFiles.clear();
		cheerpJRunMainCalls.length = 0;
		installCheerpJMock();
	});

	it('compiles with scalac on the CheerpJ classpath and runs the detected main class', async () => {
		const sandbox = new Scala();
		const outputs: string[] = [];
		const progressValues: number[] = [];
		const code = `object Main {
  def main(args: Array[String]): Unit = println(args.mkString(","))
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load(
			{
				rootUrl: '/absproxy/5173',
				scala: {
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
			sandbox.run(code, true, true, undefined, [], { activePath: 'src/Main.scala' })
		).resolves.toBe(true);
		sandbox.write('5\n');
		await expect(
			sandbox.run(code, false, true, undefined, ['one', 'two'], {
				activePath: 'src/Main.scala'
			})
		).resolves.toBe(true);

		expect((globalThis as any).cheerpjInit).toHaveBeenCalledWith({ version: 8 });
		expect(progressValues).toContain(1);
		expect(cheerpJRunMainCalls[0]).toEqual([
			'org.wasmidle.scala.Bridge',
			expect.stringContaining('/app/absproxy/5173/wasm-scala/wasm-idle-scala-bridge.jar'),
			'compile',
			expect.stringMatching(/^\/str\/wasm-idle-scala-.+-Main\.scala$/),
			expect.stringMatching(/^\/files\/wasm-idle-scala\/.+\/classes$/),
			'/app/absproxy/5173/wasm-scala/scala-library-2.13.18.jar',
			expect.stringMatching(/^\/files\/wasm-idle-scala\/.+$/)
		]);
		expect(cheerpJRunMainCalls[0][1]).toContain('scala-compiler-2.13.18.jar');
		expect(cheerpJRunMainCalls[1]).toEqual([
			'org.wasmidle.scala.Bridge',
			cheerpJRunMainCalls[0][1],
			'run',
			cheerpJRunMainCalls[0][4],
			'Main',
			'/app/absproxy/5173/wasm-scala/scala-library-2.13.18.jar',
			expect.stringMatching(/^\/str\/wasm-idle-scala-stdin-.+\.txt$/),
			expect.stringMatching(/^\/files\/wasm-idle-scala\/.+$/),
			'one',
			'two'
		]);
		expect(outputs.join('')).toContain('scalac Main.scala');
		expect(outputs.join('')).toContain('args=one,two\nstdin=5\n');
	});

	it('parses scalac diagnostics and rejects failed compilations', async () => {
		const sandbox = new Scala();
		const diagnostics: any[] = [];

		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);
		await sandbox.load({
			scala: {
				cheerpjLoaderUrl: '/cheerpj/loader.js',
				virtualBasePath: '/app/wasm-scala/'
			}
		});

		await expect(
			sandbox.run('object Main { nope }', true, true, undefined, [], {
				activePath: 'Broken.scala'
			})
		).rejects.toContain('not found: value nope');
		expect(diagnostics).toEqual([
			{
				fileName: 'Broken.scala',
				lineNumber: 2,
				columnNumber: 5,
				severity: 'error',
				message: 'not found: value nope'
			}
		]);
	});

	it('waits for terminal input before running code that reads StdIn', async () => {
		const sandbox = new Scala();
		const code = `object Main {
  def main(args: Array[String]): Unit = println(scala.io.StdIn.readLine())
}`;

		await sandbox.load({
			scala: {
				cheerpjLoaderUrl: '/cheerpj/loader.js',
				virtualBasePath: '/app/wasm-scala/'
			}
		});
		await sandbox.run(code, true, true, undefined, [], { activePath: 'Main.scala' });
		const running = sandbox.run(code, false, true, undefined, [], {
			activePath: 'Main.scala'
		});
		await Promise.resolve();

		expect(cheerpJRunMainCalls).toHaveLength(1);
		sandbox.write('9\n');
		await expect(running).resolves.toBe(true);
		expect(cheerpJRunMainCalls).toHaveLength(2);
	});

	it('parses source diagnostics emitted with a generated /str path', () => {
		expect(
			parseScalaDiagnostics(
				'/str/wasm-idle-scala-abc-Main.scala',
				'Main.scala',
				'/str/wasm-idle-scala-abc-Main.scala:7: warning: match may not be exhaustive\n    value\n      ^\n'
			)
		).toEqual([
			{
				fileName: 'Main.scala',
				lineNumber: 7,
				columnNumber: 7,
				severity: 'warning',
				message: 'match may not be exhaustive'
			}
		]);
	});
});
