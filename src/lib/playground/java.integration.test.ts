// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createJavaStdinBridge, prepareJavaRuntimeStdinInjection } from './javaRuntimeStdin';
import { prepareJavaStdinInjection } from './javaStdin';

const gunzipAsync = promisify(gunzip);

const readStaticAsset = async (relativePath: string) => {
	const assetUrl = new URL(`../../../static/teavm/${relativePath}`, import.meta.url);
	const plain = await readFile(assetUrl).catch(() => null);
	if (plain) return plain;
	return await gunzipAsync(
		await readFile(new URL(`../../../static/teavm/${relativePath}.gz`, import.meta.url))
	);
};

function installJavaStdinWindow(
	stdin: (() => number) | { readByte(): number; readChunk(): Int8Array | null }
) {
	const runtimeGlobal = globalThis as Record<string, unknown>;
	const hadWindow = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'window');
	const previousWindow = runtimeGlobal.window;
	runtimeGlobal.window = {
		wasmIdleJavaStdin: typeof stdin === 'function' ? { readByte: stdin } : stdin
	};
	return () => {
		if (hadWindow) {
			runtimeGlobal.window = previousWindow;
		} else {
			delete runtimeGlobal.window;
		}
	};
}

const loadTeaVmArtifacts = async () => {
	const runtime = await import(
		new URL('../../../static/teavm/compiler.wasm-runtime.js', import.meta.url).href
	);
	const compilerWasm = new Uint8Array(await readStaticAsset('compiler.wasm'));
	const sdk = new Int8Array(await readStaticAsset('compile-classlib-teavm.bin'));
	const runtimeClasslib = new Int8Array(await readStaticAsset('runtime-classlib-teavm.bin'));

	return { runtime, compilerWasm, sdk, runtimeClasslib };
};

describe('TeaVM Java stdin integration', () => {
	it('separates explicitly empty stdin from a streaming helper in the compile cache', () => {
		const code = `public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println(System.in.read());
    }
}`;
		const explicit = prepareJavaStdinInjection(code, '', true);
		const streaming = prepareJavaStdinInjection(code, '', false);

		expect(explicit.stdinCacheKey).not.toBe(streaming.stdinCacheKey);
		expect(explicit.helperSource).toContain('HAS_EXPLICIT_INPUT = true');
		expect(streaming.helperSource).toContain('HAS_EXPLICIT_INPUT = false');
	});

	it('generates Wasm from output class files', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const code = `public class Main {
    public static int factorial(int n) {
        return n <= 1 ? 1 : n * factorial(n - 1);
    }

    public static void main(String[] args) {
        int n = args.length > 0 ? Integer.parseInt(args[0]) : 4;
        System.out.println("factorial=" + factorial(n));
    }
}`;
		const sourceCompilerModule = await runtime.load(
			compilerWasm,
			{
				stackDeobfuscator: { enabled: false }
			},
			60_000
		);
		const sourceCompiler = sourceCompilerModule.exports.createCompiler();
		sourceCompiler.setSdk(sdk);
		sourceCompiler.setTeaVMClasslib(runtimeClasslib);
		sourceCompiler.addSourceFile('Main.java', code);

		expect(sourceCompiler.compile()).toBe(true);
		const mainClassFile = new Int8Array(sourceCompiler.getOutputFile('Main.class'));

		const outputCompilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const outputCompiler = outputCompilerModule.exports.createCompiler();
		const diagnostics: string[] = [];
		outputCompiler.setSdk(sdk);
		outputCompiler.setTeaVMClasslib(runtimeClasslib);
		outputCompiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		outputCompiler.addOutputClassFile('Main.class', mainClassFile);

		expect(Array.from(outputCompiler.detectMainClasses())).toEqual(['Main']);
		expect(outputCompiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(
			true
		);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(outputCompiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		const module = await runtime.load(wasm, {
			installImports(imports: {
				teavmConsole: {
					putcharStdout: (code: number) => void;
					putcharStderr: (code: number) => void;
				};
			}) {
				imports.teavmConsole.putcharStdout = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
				imports.teavmConsole.putcharStderr = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
			},
			stackDeobfuscator: { enabled: false }
		});

		module.exports.main(['5']);

		expect(outputs.join('')).toBe('factorial=120\n');
	}, 60_000);

	it('compiles and runs a canonical multi-file Java workspace', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		const diagnostics: string[] = [];

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		compiler.addSourceFile(
			'Main.java',
			`package demo;

public class Main {
    public static void main(String[] args) {
        System.out.println(Helper.value());
    }
}`
		);
		compiler.addSourceFile(
			'Helper.java',
			`package demo;

final class Helper {
    static int value() {
        return 42;
    }
}`
		);

		expect(compiler.compile(), diagnostics.join('\n')).toBe(true);
		expect(Array.from(compiler.detectMainClasses())).toEqual(['demo/Main']);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'demo.Main' })).toBe(
			true
		);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		const module = await runtime.load(wasm, {
			installImports(imports: {
				teavmConsole: {
					putcharStdout: (code: number) => void;
					putcharStderr: (code: number) => void;
				};
			}) {
				imports.teavmConsole.putcharStdout = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
				imports.teavmConsole.putcharStderr = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
			},
			stackDeobfuscator: { enabled: false }
		});

		module.exports.main([]);
		expect(outputs.join('')).toBe('42\n');
	}, 60_000);

	it('compiles and runs NIO byte buffer code under Wasm GC', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		// The bundled runtime classlib must not retain JS-only @JSByRef typed array paths.
		const code = `import java.nio.ByteBuffer;

public class Main {
    public static void main(String[] args) {
        ByteBuffer allocated = ByteBuffer.allocate(8);
        allocated.putInt(42);
        allocated.flip();

        byte[] source = new byte[] { 0, 0, 0, 7 };
        ByteBuffer wrapped = ByteBuffer.wrap(source);
        System.out.println(allocated.getInt() + wrapped.getInt());
    }
}`;
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		const diagnostics: string[] = [];

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		compiler.addSourceFile('Main.java', code);

		expect(compiler.compile()).toBe(true);
		expect(Array.from(compiler.detectMainClasses())).toEqual(['Main']);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		const module = await runtime.load(wasm, {
			installImports(imports: {
				teavmConsole: {
					putcharStdout: (code: number) => void;
					putcharStderr: (code: number) => void;
				};
			}) {
				imports.teavmConsole.putcharStdout = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
				imports.teavmConsole.putcharStderr = (charCode) =>
					outputs.push(String.fromCharCode(charCode));
			},
			stackDeobfuscator: { enabled: false }
		});

		module.exports.main([]);

		expect(outputs.join('')).toBe('49\n');
	}, 60_000);

	it('compiles and runs character stream, NIO buffer and Formatter programs under Wasm GC', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		// Readers and Writers reach CharBuffer.allocate/wrap. The bundled runtime classlib must
		// not retain their JS-only @JSByRef typed array paths.
		const cases = [
			{
				name: 'BufferedReader with StringTokenizer',
				code: `import java.io.*;
import java.util.StringTokenizer;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int a = Integer.parseInt(st.nextToken());
        int b = Integer.parseInt(st.nextToken());
        System.out.println(a + b);
    }
}`,
				stdin: '1 2\n',
				expected: '3\n'
			},
			{
				name: 'BufferedReader lines until EOF with UTF-8 input',
				code: `import java.io.*;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br =
            new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = br.readLine()) != null) {
            System.out.println(line.length() + ":" + line);
        }
    }
}`,
				stdin: '안녕 hi\nlast',
				expected: '5:안녕 hi\n4:last\n'
			},
			{
				name: 'StreamTokenizer over BufferedReader',
				code: `import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        StreamTokenizer st =
            new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        int sum = 0;
        while (st.nextToken() != StreamTokenizer.TT_EOF) sum += (int) st.nval;
        System.out.println("sum=" + sum);
    }
}`,
				stdin: '3 4\n5\n',
				expected: 'sum=12\n'
			},
			{
				name: 'BufferedWriter and PrintWriter flushes',
				code: `import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedWriter bw = new BufferedWriter(new OutputStreamWriter(System.out));
        for (int i = 0; i < 20; i++) bw.write("line " + i + " 한글\\n");
        bw.flush();
        PrintWriter pw = new PrintWriter(System.out);
        pw.println("pw");
        pw.flush();
        bw.write("end");
        bw.newLine();
        bw.flush();
        bw.close();
    }
}`,
				stdin: '',
				expected: `${Array.from({ length: 20 }, (_, i) => `line ${i} 한글\n`).join('')}pw\nend\n`
			},
			{
				// %n and %% do not consume an argument (TeaVM #1317)
				name: 'Formatter line separator and escaped percent',
				code: `public class Main {
    public static void main(String[] args) {
        System.out.printf("%d%n", 7);
        System.out.print(String.format("%d%% of %s|%% %d|%5%|%-5%|%n", 50, "x", 5));
        try {
            String.format("%5n");
        } catch (RuntimeException e) {
            System.out.println("rejected: " + e);
        }
    }
}`,
				stdin: '',
				expected:
					'7\n50% of x|% 5|    %|%    |\nrejected: java.util.IllegalFormatWidthException: Illegal width: 5\n'
			},
			{
				// Dependency plugins must run in the browser compiler (TeaVM #1322): without them a clone()
				// result loses its type, so virtual calls on it (including inside Formatter's %f) trap.
				name: 'cloned objects and floating-point formatting',
				code: `public class Main {
    static abstract class Shape implements Cloneable {
        abstract double area();

        Shape copy() {
            try {
                return (Shape) super.clone();
            } catch (CloneNotSupportedException e) {
                throw new RuntimeException(e);
            }
        }
    }

    static class Square extends Shape {
        double side = 3;

        double area() {
            return side * side;
        }
    }

    static class Circle extends Shape {
        double r = 1;

        double area() {
            return 3 * r * r;
        }
    }

    public static void main(String[] args) {
        for (Shape shape : new Shape[] { new Square(), new Circle() }) {
            System.out.println(shape.copy().area());
        }
        System.out.println(String.format("%.2f", 1.5));
        System.out.printf("%.3f|%8.2f|%n", 2.0 / 3, -12.346);
    }
}`,
				stdin: '',
				expected: '9.0\n3.0\n1.50\n0.667|  -12.35|\n'
			},
			{
				// %f rounds half up on the shortest decimal representation (TeaVM #1323)
				name: 'Formatter half-up rounding',
				code: `public class Main {
    public static void main(String[] args) {
        System.out.println(String.format("%.1f %.2f %.0f %.2f %.2f %8.2f|", 0.25, 0.125, 2.5, 1.005, 2.675, -12.345));
    }
}`,
				stdin: '',
				expected: '0.3 0.13 3 1.01 2.68   -12.35|\n'
			},
			{
				// A flush must not end the console decoder's input: a later byte write threw
				// IllegalStateException and a split UTF-8 character was replaced.
				name: 'System.out byte writes across flushes',
				code: `public class Main {
    public static void main(String[] args) throws Exception {
        System.out.write('a');
        System.out.flush();
        System.out.write("bc\\n".getBytes());
        System.out.flush();
        byte[] euro = "\\u20ac\\n".getBytes("UTF-8");
        System.out.write(euro, 0, 1);
        System.out.flush();
        System.out.write(euro, 1, euro.length - 1);
        System.out.flush();
    }
}`,
				stdin: '',
				expected: 'abc\n\u20ac\n'
			},
			{
				// The javac SDK must expose @Rename'd class library methods under their Java names.
				name: 'exception methods, getClass and collection clone',
				code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        try {
            throw new IllegalStateException("boom");
        } catch (RuntimeException e) {
            System.out.println(e.getClass().getName() + ": " + e.getMessage());
        }
        Object list = new ArrayList<>(List.of(3, 1, 2));
        System.out.println(list.getClass().getSimpleName());
        ArrayList<Integer> original = new ArrayList<>(List.of(1, 2));
        HashMap<String, Integer> map = new HashMap<>(Map.of("a", 1));
        System.out.println(original.clone() + " " + map.clone());
    }
}`,
				stdin: '',
				expected: 'java.lang.IllegalStateException: boom\nArrayList\n[1, 2] {a=1}\n'
			},
			{
				// Enum reflection must link values(): getEnumConstants() was empty and valueOf,
				// EnumSet and EnumMap trapped or printed Main$Color@...
				name: 'enum reflection',
				code: `import java.util.*;

public class Main {
    enum Color { RED, GREEN, BLUE }

    enum Op {
        ADD { int apply(int a, int b) { return a + b; } },
        MUL { int apply(int a, int b) { return a * b; } };

        abstract int apply(int a, int b);
    }

    public static void main(String[] args) {
        System.out.println(Color.class.getEnumConstants().length + " " + Color.valueOf("GREEN"));
        System.out.println(EnumSet.allOf(Color.class) + " " + EnumSet.complementOf(EnumSet.of(Color.RED)));
        EnumMap<Color, Integer> map = new EnumMap<>(Color.class);
        map.put(Color.BLUE, 3);
        map.put(Color.RED, 1);
        System.out.println(map);
        Op op = Enum.valueOf(Op.class, "MUL");
        System.out.println(op + " " + op.apply(6, 7) + " " + EnumSet.allOf(Op.class));
    }
}`,
				stdin: '',
				expected:
					'3 GREEN\n[RED, GREEN, BLUE] [GREEN, BLUE]\n{RED=1, BLUE=3}\nMUL 42 [ADD, MUL]\n'
			},
			{
				// Annotation element values overflowed javac's stack: the SDK's Annotation extended itself.
				name: 'annotations with element values',
				code: `import java.lang.annotation.*;
import java.util.*;

public class Main {
    @Retention(RetentionPolicy.RUNTIME)
    @interface Label {
        String value() default "none";
    }

    @Label("main")
    @SuppressWarnings({ "unchecked", "rawtypes" })
    public static void main(String[] args) {
        @SuppressWarnings("unchecked")
        List<Integer> list = (List<Integer>) (List) new ArrayList<>(List.of(3, 1, 2));
        for (@SuppressWarnings("unused") int i = 0; i < 1; i++) {
            Collections.sort(list);
        }
        System.out.println(list);
    }
}`,
				stdin: '',
				expected: '[1, 2, 3]\n'
			},
			{
				// A primitive array clone that does not escape its method trapped: int[] had no clone function.
				name: 'primitive array clone',
				code: `import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] dp = { 1, 2, 3 };
        int[] next = dp.clone();
        next[0] = 9;
        long[] sums = { 4L };
        long[] copy = sums.clone();
        char[] word = "ab".toCharArray().clone();
        int[][] grid = { { 1, 2 }, { 3, 4 } };
        int[] row = grid[1].clone();
        row[0] = 7;
        System.out.println(dp[0] + " " + next[0] + " " + next.length + " " + copy[0] + " " + word[1]
            + " " + grid[1][0] + " " + row[0] + " " + Arrays.toString(dp));
    }
}`,
				stdin: '',
				expected: '1 9 3 4 b 3 7 [1, 2, 3]\n'
			},
			{
				// JCLPlugin skips ServiceLoader and runtime-annotation support when TeaVM is compiled by
				// TeaVM, and String element values got no type, so concatenating one trapped.
				name: 'runtime annotations and ServiceLoader',
				code: `import java.lang.annotation.*;
import java.util.ServiceLoader;

public class Main {
    @Retention(RetentionPolicy.RUNTIME)
    @interface Tag {
        String value();
        int level() default 1;
        String[] aliases() default {};
    }

    @interface Hidden {}

    @Tag(value = "solver", level = 3, aliases = { "s", "sv" })
    @Hidden
    static class Solver {}

    @Tag("plain")
    static class Plain {}

    public static void main(String[] args) {
        Tag tag = Solver.class.getAnnotation(Tag.class);
        Tag plain = Plain.class.getAnnotation(Tag.class);
        int services = 0;
        for (Runnable service : ServiceLoader.load(Runnable.class)) {
            services++;
        }
        System.out.println(tag.value() + " " + tag.level() + " " + String.join("/", tag.aliases()) + " "
            + plain.value() + " " + plain.level() + " " + plain.aliases().length
            + " " + Solver.class.isAnnotationPresent(Hidden.class)
            + " " + (Main.class.getAnnotation(Tag.class) == null) + " " + services);
    }
}`,
				stdin: '',
				expected: 'solver 3 s/sv plain 1 0 false true 0\n'
			},
			{
				// TeaVM 0.13.1 lacks these methods: print(float) and println(char[]) resolved to
				// print(double) and println(Object), and %e was an unknown format conversion.
				name: 'class library methods missing from TeaVM 0.13.1',
				code: `import java.util.*;
import java.util.stream.*;

public class Main {
    public static void main(String[] args) {
        System.out.print(0.1f);
        System.out.print(' ');
        System.out.print(true);
        System.out.print(' ');
        System.out.println(new char[] { 'o', 'k' });
        System.out.writeBytes("bytes\\n".getBytes());
        Map<String, Integer> counts = new TreeMap<>();
        for (String word : "b a b".split(" ")) {
            counts.merge(word, 1, Integer::sum);
        }
        TreeMap<Integer, Long> parity = Stream.of(1, 2, 3, 4, 5)
            .collect(Collectors.groupingBy(x -> x % 2, TreeMap::new, Collectors.counting()));
        System.out.println(counts + " " + parity + " " + Long.max(3L, 5L) + " " + Long.sum(3L, 5L)
            + " " + Double.sum(1.5, 2.0) + " " + Float.min(1.5f, 2.0f));
        System.out.println(Math.multiplyHigh(Long.MAX_VALUE, 3L) + " " + Math.multiplyFull(100000, 100000)
            + " " + Character.toString(0x1F600).length() + " " + Integer.toUnsignedLong(-1)
            + " " + Integer.parseUnsignedInt("4294967295") + " " + Long.parseUnsignedLong("18446744073709551615"));
        System.out.println(List.of(1, 2, 3).parallelStream().mapToInt(Integer::intValue).sum()
            + " " + Stream.ofNullable(null).count() + " " + "a\\r\\nb\\nc".lines().collect(Collectors.toList())
            + " " + "x".transform(s -> s + "y"));
        System.out.println(String.format("%e|%.2e|%E|%+.1e|%010.2e|%.0e", 12345.678, 0.000123, 1.0, 99.95, -1.5, 2.5));
    }
}`,
				stdin: '',
				expected:
					'0.1 true ok\nbytes\n{a=1, b=2} {0=2, 1=3} 5 8 3.5 1.5\n1 10000000000 2 4294967295 -1 -1\n6 0 [a, b, c] xy\n1.234568e+04|1.23e-04|1.000000E+00|+1.0e+02|-01.50e+00|3e+00\n'
			},
			{
				name: 'typed NIO buffers',
				code: `import java.nio.*;

public class Main {
    public static void main(String[] args) {
        char[] chars = new char[2];
        CharBuffer.wrap(new char[] { 'o', 'k' }).get(chars);
        CharBuffer allocated = CharBuffer.allocate(2).put(chars);
        allocated.flip();
        System.out.println(allocated);
        System.out.println(ShortBuffer.wrap(new short[] { 1 }).get(0)
            + IntBuffer.allocate(1).put(0, 2).get(0)
            + LongBuffer.wrap(new long[] { 3 }).get(0)
            + FloatBuffer.allocate(1).put(0, 4.5f).get(0)
            + DoubleBuffer.wrap(new double[] { 5.25 }).get(0));
    }
}`,
				stdin: '',
				expected: 'ok\n15.75\n'
			}
		];

		for (const testCase of cases) {
			const injection = prepareJavaRuntimeStdinInjection(testCase.code);
			const compilerModule = await runtime.load(compilerWasm, {
				stackDeobfuscator: { enabled: false }
			});
			const compiler = compilerModule.exports.createCompiler();
			const diagnostics: string[] = [];

			compiler.setSdk(sdk);
			compiler.setTeaVMClasslib(runtimeClasslib);
			compiler.onDiagnostic((diagnostic: { message?: string }) => {
				diagnostics.push(String(diagnostic.message || ''));
			});
			compiler.addSourceFile('Main.java', injection.transformedCode);
			if (injection.helperSourcePath && injection.helperSource) {
				compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
			}

			expect(compiler.compile(), `${testCase.name}: ${diagnostics.join('\n')}`).toBe(true);
			expect(
				compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' }),
				`${testCase.name}: ${diagnostics.join('\n')}`
			).toBe(true);
			expect(diagnostics, testCase.name).toEqual([]);

			const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
			const outputs: string[] = [];
			const bridge = createJavaStdinBridge(testCase.stdin, true, () => null);
			const restoreWindow = installJavaStdinWindow(bridge);

			try {
				const module = await runtime.load(wasm, {
					installImports(imports: {
						teavmConsole: {
							putcharStdout: (code: number) => void;
							putcharStderr: (code: number) => void;
						};
					}) {
						imports.teavmConsole.putcharStdout = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
						imports.teavmConsole.putcharStderr = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
					},
					stackDeobfuscator: { enabled: false }
				});

				module.exports.main([]);
			} finally {
				bridge.dispose();
				restoreWindow();
			}

			expect(outputs.join(''), testCase.name).toBe(testCase.expected);
		}
	}, 180_000);

	it('compiles and runs byte-oriented stdin code with injected snapshot input', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const code = `public class Main {
    public static void main(String[] args) throws Exception {
        int sum = 0;
        int value = 0;
        boolean inNumber = false;
        int ch;

        while ((ch = System.in.read()) != -1) {
            if (ch >= '0' && ch <= '9') {
                value = value * 10 + (ch - '0');
                inNumber = true;
            } else if (inNumber) {
                sum += value;
                value = 0;
                inNumber = false;
            }
        }

        if (inNumber) {
            sum += value;
        }

        System.out.println("sum=" + sum);
    }
}`;
		const stdin = 'é 1 2 3 4\n';
		const injection = prepareJavaStdinInjection(code, stdin, true);
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		const diagnostics: string[] = [];

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		compiler.addSourceFile('Main.java', injection.transformedCode);
		if (injection.helperSourcePath && injection.helperSource) {
			compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
		}

		expect(compiler.compile()).toBe(true);
		expect(Array.from(compiler.detectMainClasses())).toEqual(['Main']);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		let hostReadCount = 0;
		const unexpectedHostBytes = ['9'.charCodeAt(0)];
		const restoreWindow = installJavaStdinWindow(() => {
			hostReadCount += 1;
			return unexpectedHostBytes.shift() ?? -1;
		});

		try {
			const module = await runtime.load(wasm, {
				installImports(imports: {
					teavmConsole: {
						putcharStdout: (code: number) => void;
						putcharStderr: (code: number) => void;
					};
				}) {
					imports.teavmConsole.putcharStdout = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
					imports.teavmConsole.putcharStderr = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
				},
				stackDeobfuscator: { enabled: false }
			});

			module.exports.main([]);
		} finally {
			restoreWindow();
		}

		expect(outputs.join('')).toBe('sum=10\n');
		expect(hostReadCount).toBe(0);
	}, 60_000);

	it('returns immediate EOF for explicitly empty stdin', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const code = `public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println("value=" + System.in.read());
    }
}`;
		const injection = prepareJavaStdinInjection(code, '', true);
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();
		const diagnostics: string[] = [];

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.onDiagnostic((diagnostic: { message?: string }) => {
			diagnostics.push(String(diagnostic.message || ''));
		});
		compiler.addSourceFile('Main.java', injection.transformedCode);
		if (injection.helperSourcePath && injection.helperSource) {
			compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
		}

		expect(compiler.compile()).toBe(true);
		expect(Array.from(compiler.detectMainClasses())).toEqual(['Main']);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);
		expect(diagnostics).toEqual([]);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		let hostReadCount = 0;
		const restoreWindow = installJavaStdinWindow(() => {
			hostReadCount += 1;
			return 'A'.charCodeAt(0);
		});

		try {
			const module = await runtime.load(wasm, {
				installImports(imports: {
					teavmConsole: {
						putcharStdout: (code: number) => void;
						putcharStderr: (code: number) => void;
					};
				}) {
					imports.teavmConsole.putcharStdout = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
					imports.teavmConsole.putcharStderr = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
				},
				stackDeobfuscator: { enabled: false }
			});

			module.exports.main([]);
		} finally {
			restoreWindow();
		}

		expect(outputs.join('')).toBe('value=-1\n');
		expect(hostReadCount).toBe(0);
	}, 60_000);

	it('reads live stdin chunks through the custom TeaVM bridge', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const code = `public class Main {
    public static void main(String[] args) throws Exception {
        int first = System.in.read();
        int second = System.in.read();
        int third = System.in.read();
        System.out.println("" + (char) first + (char) second + (char) third);
    }
}`;
		const injection = prepareJavaStdinInjection(code, '', false);
		const compilerModule = await runtime.load(compilerWasm, {
			stackDeobfuscator: { enabled: false }
		});
		const compiler = compilerModule.exports.createCompiler();

		compiler.setSdk(sdk);
		compiler.setTeaVMClasslib(runtimeClasslib);
		compiler.addSourceFile('Main.java', injection.transformedCode);
		if (injection.helperSourcePath && injection.helperSource) {
			compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
		}

		expect(compiler.compile()).toBe(true);
		expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(true);

		const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
		const outputs: string[] = [];
		const bytes = ['A', 'B', 'C'].map((value) => value.charCodeAt(0));
		const restoreWindow = installJavaStdinWindow(() => bytes.shift() ?? -1);

		try {
			const module = await runtime.load(wasm, {
				installImports(imports: {
					teavmConsole: {
						putcharStdout: (code: number) => void;
						putcharStderr: (code: number) => void;
					};
				}) {
					imports.teavmConsole.putcharStdout = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
					imports.teavmConsole.putcharStderr = (charCode) =>
						outputs.push(String.fromCharCode(charCode));
				},
				stackDeobfuscator: { enabled: false }
			});

			module.exports.main([]);
		} finally {
			restoreWindow();
		}

		expect(outputs.join('')).toBe('ABC\n');
	}, 60_000);

	it('compiles and runs Scanner-based stdin code across common import styles', async () => {
		const { runtime, compilerWasm, sdk, runtimeClasslib } = await loadTeaVmArtifacts();
		const cases = [
			{
				name: 'explicit import',
				code: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println(scanner.nextInt() + scanner.nextInt());
    }
}`
			},
			{
				name: 'wildcard import',
				code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println(scanner.nextInt() + scanner.nextInt());
    }
}`
			},
			{
				name: 'fully qualified name',
				code: `public class Main {
    public static void main(String[] args) {
        java.util.Scanner scanner = new java.util.Scanner(System.in);
        System.out.println(scanner.nextInt() + scanner.nextInt());
    }
}`
			},
			{
				name: 'bare scanner',
				code: `public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.println(scanner.nextInt() + scanner.nextInt());
    }
}`
			}
		];

		for (const testCase of cases) {
			const injection = prepareJavaStdinInjection(testCase.code, '1 2\n', true);
			const compilerModule = await runtime.load(compilerWasm, {
				stackDeobfuscator: { enabled: false }
			});
			const compiler = compilerModule.exports.createCompiler();
			const diagnostics: string[] = [];

			compiler.setSdk(sdk);
			compiler.setTeaVMClasslib(runtimeClasslib);
			compiler.onDiagnostic((diagnostic: { message?: string }) => {
				diagnostics.push(String(diagnostic.message || ''));
			});
			compiler.addSourceFile('Main.java', injection.transformedCode);
			if (injection.helperSourcePath && injection.helperSource) {
				compiler.addSourceFile(injection.helperSourcePath, injection.helperSource);
			}

			if (!compiler.compile()) {
				throw new Error(`${testCase.name}: ${diagnostics.join('\n')}`);
			}
			expect(Array.from(compiler.detectMainClasses())).toEqual(['Main']);
			expect(compiler.generateWebAssembly({ outputName: 'app', mainClass: 'Main' })).toBe(
				true
			);

			const wasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
			const outputs: string[] = [];
			const restoreWindow = installJavaStdinWindow(() => -1);

			try {
				const module = await runtime.load(wasm, {
					installImports(imports: {
						teavmConsole: {
							putcharStdout: (code: number) => void;
							putcharStderr: (code: number) => void;
						};
					}) {
						imports.teavmConsole.putcharStdout = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
						imports.teavmConsole.putcharStderr = (charCode) =>
							outputs.push(String.fromCharCode(charCode));
					},
					stackDeobfuscator: { enabled: false }
				});

				module.exports.main([]);
			} finally {
				restoreWindow();
			}

			expect(outputs.join('')).toBe('3\n');
		}
	}, 60_000);
});
