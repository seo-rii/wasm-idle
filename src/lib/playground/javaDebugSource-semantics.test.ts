// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentJavaDebugSource } from './javaDebugSource';

// These tests compare the original and transformed programs in a real JVM.
// TeaVM/JSO execution and debugger events have a separate browser qualification.
const enabled = process.env.WASM_IDLE_RUN_JAVA_TRANSFORM_SEMANTICS === '1';
const directories: string[] = [];
const bridgeSource = `public final class WasmIdleDebugProbe {
    public static void hit(String sourcePath, int line, int column) {}
}`;

function executeJava(source: string, directory: string, helperSource = bridgeSource) {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'Main.java'), source);
	writeFileSync(join(directory, 'WasmIdleDebugProbe.java'), helperSource);
	const compiled = spawnSync(
		process.env.WASM_IDLE_JAVAC || 'javac',
		[
			'-J-Xmx128m',
			'--release',
			'17',
			'-g',
			'-d',
			directory,
			join(directory, 'Main.java'),
			join(directory, 'WasmIdleDebugProbe.java')
		],
		{ encoding: 'utf8', timeout: 10_000 }
	);
	expect(compiled.error, compiled.stderr).toBeUndefined();
	expect(compiled.status, compiled.stderr).toBe(0);
	const executed = spawnSync(
		process.env.WASM_IDLE_JAVA || 'java',
		['-Xmx64m', '-ea', '-cp', directory, 'Main'],
		{ encoding: 'utf8', timeout: 10_000 }
	);
	expect(executed.error, executed.stderr).toBeUndefined();
	return { status: executed.status, stdout: executed.stdout, stderr: executed.stderr };
}

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), 'wasm-idle-java-debug-semantics-'));
	directories.push(directory);
	return directory;
}

const cases = [
	{
		name: 'unbraced branches and dangling else',
		source: `public class Main {
    static int branch(int n) {
        if (n > 0)
            if (n % 2 == 0) return 1;
            else return 2;
        return 3;
    }
    public static void main(String[] args) {
        for (int i = -1; i <= 3; i++) System.out.print(branch(i) + ",");
    }
}`
	},
	{
		name: 'for declarations, empty bodies, and unbraced loops',
		source: `public class Main {
    public static void main(String[] args) {
        int value = 0;
        for (int i = 0, j = 2; i < 4; i++, j--) value += i + j;
        while (value < 12) value++;
        do value--; while (value > 8);
        for (int item : new int[] {2, 3}) value += item;
        for (int i = 0; i < 3; i++);
        System.out.print(value);
    }
}`
	},
	{
		name: 'labeled continue, break, and labeled blocks',
		source: `public class Main {
    public static void main(String[] args) {
        int sum = 0;
        outer: for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++) {
                if (j == 2) continue outer;
                if (i == 3) break outer;
                sum += i * 10 + j;
            }
        done: {
            if (sum > 0) break done;
            sum = -1;
        }
        System.out.print(sum);
    }
}`
	},
	{
		name: 'switch fallthrough and arrow statement bodies',
		source: `public class Main {
    public static void main(String[] args) {
        int sum = 0;
        for (int mode = 0; mode < 4; mode++) {
            switch (mode) {
                case 0: int value = 4; sum += value;
                case 1: sum += 3; break;
                case 2: { sum += 7; } break;
                default: sum += 9;
            }
            switch (mode) {
                case 0, 1 -> System.out.print("A");
                case 2 -> { System.out.print("B"); }
                default -> System.out.print("C");
            }
        }
        System.out.print(sum);
    }
}`
	},
	{
		name: 'switch expressions, yield, nested switches, and target-typed results',
		source: `public class Main {
    static int result(int mode) {
        return switch (mode) {
            case 0 -> 2;
            case 1 -> { int value = 3; yield value; }
            case 2 -> switch (mode + 1) { case 3 -> 5; default -> 7; };
            default -> throw new IllegalArgumentException("unexpected");
        };
    }
    public static void main(String[] args) {
        java.util.function.IntSupplier deferred = switch (args.length) {
            case 0 -> () -> 11;
            default -> () -> 13;
        };
        Object reference = switch (args.length) { case 0 -> null; default -> "text"; };
        System.out.print(result(0) + result(1) + result(2) + ":" + deferred.getAsInt() + ":" + reference);
    }
}`
	},
	{
		name: 'constructor delegation and explicit superclass calls',
		source: `public class Main {
    static String trace = "";
    Main() { this(2); trace += "D"; }
    Main(int value) { super(); trace += "B" + value; }
    public static void main(String[] args) {
        new Main();
        System.out.print(trace);
    }
}`
	},
	{
		name: 'return, throw, catch, finally, and resource closing',
		source: `public class Main {
    static class Resource implements AutoCloseable {
        public void close() { System.out.print("close;"); }
    }
    static int run(boolean fail) {
        try (Resource resource = new Resource()) {
            if (fail) throw new IllegalArgumentException("expected");
            return 4;
        } catch (IllegalArgumentException error) {
            System.out.print(error.getMessage() + ";");
            return 7;
        } finally {
            System.out.print("finally;");
        }
    }
    public static void main(String[] args) {
        System.out.print(run(false) + "," + run(true));
    }
}`
	},
	{
		name: 'expression and block lambdas',
		source: `public class Main {
    public static void main(String[] args) {
        java.util.function.IntUnaryOperator increment = value -> value + 1;
        java.util.function.IntSupplier deferred = () -> { return increment.applyAsInt(4); };
        Runnable output = () -> System.out.print("lambda=" + deferred.getAsInt());
        output.run();
    }
}`
	},
	{
		name: 'text blocks, comments, and code-shaped string contents',
		source: `public class Main {
    public static void main(String[] args) {
        String text = """
if (flag) bad();
} else { return; }
""";
        // for (;;) { this is a comment, not executable Java }
        /* return; throw new Error(); */
        System.out.print(text.replace("\\n", "|") + " // if (true) return;");
    }
}`
	},
	{
		name: 'recursion and finally during recursive returns',
		source: `public class Main {
    static int calls = 0;
    static int factorial(int value) {
        if (value <= 1) return 1;
        try { return value * factorial(value - 1); }
        finally { calls++; }
    }
    public static void main(String[] args) {
        System.out.print(factorial(5) + ":" + calls);
    }
}`
	},
	{
		name: 'definite assignment, scoped declarations, and initialization blocks',
		source: `public class Main {
    static int initialized;
    static { initialized = 2; }
    { initialized++; }
    record Item(int value) {
        Item { if (value < 0) throw new IllegalArgumentException(); }
    }
    public static void main(String[] args) {
        int value;
        if (args.length == 0) value = 5; else value = 8;
        { int scoped = 2; value += scoped; }
        { int scoped = 3; value += scoped; }
        new Main();
        synchronized (Main.class) { value += initialized; }
        assert value > 0 : "value must be positive";
        System.out.print(new Item(value).value());
    }
}`
	},
	{
		name: 'uncaught exception propagation and original stack line numbers',
		source: `public class Main {
    static void fail() {
        throw new IllegalArgumentException("debug-semantics-sentinel");
    }
    public static void main(String[] args) {
        fail();
    }
}`
	}
];

describe.skipIf(!enabled)('Java source debug instrumentation JVM semantics', () => {
	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});

	it.each(cases)('preserves $name', { timeout: 30_000 }, ({ source }) => {
		const directory = temporaryDirectory();
		const original = executeJava(source, join(directory, 'original'));
		const instrumented = instrumentJavaDebugSource(source, 'Main.java', 'WasmIdleDebugProbe');
		expect(instrumented.locations.length).toBeGreaterThan(0);
		expect(instrumented.code.split('\n')).toHaveLength(source.split('\n').length);
		expect(executeJava(instrumented.code, join(directory, 'instrumented'))).toEqual(original);
	});

	it(
		'rejects compiler-preprocessed Unicode escapes before changing source',
		{ timeout: 20_000 },
		() => {
			const source = String.raw`public class Main {
    public static void ma\u0069n(String[] args) { System.out.print("unicode"); }
}`;
			const original = executeJava(source, temporaryDirectory());
			expect(original).toEqual({ status: 0, stdout: 'unicode', stderr: '' });
			expect(() =>
				instrumentJavaDebugSource(source, 'Main.java', 'WasmIdleDebugProbe')
			).toThrow(/unicode/i);
		}
	);

	it(
		'keeps an adjacent statement callback outside an untaken unbraced branch',
		{ timeout: 20_000 },
		() => {
			const source =
				'public class Main { public static void main(String[] args) {if (false) System.out.print("never");System.out.print("always");} }';
			const instrumented = instrumentJavaDebugSource(
				source,
				'Main.java',
				'WasmIdleDebugProbe'
			);
			const output = executeJava(
				instrumented.code,
				temporaryDirectory(),
				`public final class WasmIdleDebugProbe {
    public static void hit(String path, int line, int column) { System.err.print(column + ","); }
}`
			);
			expect(output.status).toBe(0);
			expect(output.stdout).toBe('always');
			const columns = output.stderr.split(',').filter(Boolean).map(Number);
			expect(columns).toContain(source.indexOf('System.out.print("always")') + 1);
			expect(columns).not.toContain(source.indexOf('System.out.print("never")') + 1);
		}
	);

	it.each(['while (true) {}', 'outer: for (;;) {}'])(
		'polls debug callbacks on every iteration of %s',
		{ timeout: 20_000 },
		(loop) => {
			const source = `public class Main { public static void main(String[] args) { ${loop} } }`;
			const instrumented = instrumentJavaDebugSource(
				source,
				'Main.java',
				'WasmIdleDebugProbe'
			);
			const output = executeJava(
				instrumented.code,
				temporaryDirectory(),
				`public final class WasmIdleDebugProbe {
    static int hits;
    public static void hit(String path, int line, int column) {
        if (++hits == 6) { System.out.print("polls=6"); System.exit(0); }
    }
}`
			);
			expect(output).toEqual({ status: 0, stdout: 'polls=6', stderr: '' });
		}
	);
});
