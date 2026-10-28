import { describe, expect, it } from 'vitest';
import { instrumentJavaDebugSource } from './javaDebugSource';

describe('Java source debug instrumentation', () => {
	it('adds bounded direct field readers only to ordinary classes with declared instance fields', () => {
		const source = `class Box<T> implements Runnable {
    private T item;
    int values[], other;
    static int ignored;
    public void run() {}
    record Record(int value) {}
    enum Enum { ITEM; int value; }
}`;
		const result = instrumentJavaDebugSource(source, 'Box.java', 'dbg.DebugProbe');
		expect(result.code).toContain('implements Runnable,dbg.DebugProbe.Inspectable');
		expect(result.code).toContain('new dbg.DebugProbe.Field("item","T",this.item)');
		expect(result.code).toContain('new dbg.DebugProbe.Field("values","int[]",this.values)');
		expect(result.code).toContain('new dbg.DebugProbe.Field("other","int",this.other)');
		expect(result.code).not.toContain('this.ignored');
		expect(result.code.match(/DebugProbe_fieldOwner\(\)/g)).toHaveLength(1);
		expect(result.code.split('\n')).toHaveLength(source.split('\n').length);
	});

	it('bounds field accessors and leaves generated-name collisions opaque', () => {
		const source = `class Large { ${Array.from({ length: 260 }, (_, i) => `int field${i};`).join('')} }`;
		const result = instrumentJavaDebugSource(source, 'Large.java', 'DebugProbe');
		expect(result.code).toContain('DebugProbe_fieldCount(){return 257;}');
		expect(result.code).toContain('4 fields omitted (256-field inspection limit)');
		expect(result.code).toContain('this.field255');
		expect(result.code).not.toContain('this.field256');
		const collision = 'class Value { int value; void DebugProbe_field(int index) {} }';
		expect(instrumentJavaDebugSource(collision, 'Value.java', 'DebugProbe').code).not.toContain(
			'DebugProbe.Inspectable'
		);
	});

	it('reports original statement locations and preserves CRLF source lines', () => {
		const source = [
			'public class Main {',
			'    public static void main(String[] args) {',
			'        int value = 2;',
			'        System.out.print(value);',
			'    }',
			'}'
		].join('\r\n');
		const transformed = instrumentJavaDebugSource(source, 'example/Main.java', 'DebugProbe');
		expect(transformed.locations).toContainEqual({ line: 3, column: 9 });
		expect(transformed.locations).toContainEqual({ line: 4, column: 9 });
		expect(transformed.code.match(/\r\n/g)).toHaveLength(5);
		expect(transformed.code).toContain('if(DebugProbe.poll("example/Main.java",3,9))');
		expect(transformed.code).toContain(
			'DebugProbe.hit("example/Main.java",3,9,new java.lang.String[]{"args"},new java.lang.String[]{"String[]"},new java.lang.Object[]{DebugProbe.capture(args)});'
		);
		expect(transformed.code).toContain(
			'DebugProbe.hit("example/Main.java",4,9,new java.lang.String[]{"args","value"},new java.lang.String[]{"String[]","int"},new java.lang.Object[]{DebugProbe.capture(args),DebugProbe.capture(value)});'
		);
	});

	it('omits uninitialized and flow-scoped bindings instead of changing definite assignment', () => {
		const source = `class Main {
    void run(Object candidate, boolean flag) {
        int uninitialized;
        int conditional;
        if (flag) conditional = 1; else conditional = 2;
        int initialized = 3;
        if (candidate instanceof String pattern) {
            System.out.print(pattern + conditional + initialized);
        }
    }
}`;
		const result = instrumentJavaDebugSource(source, 'Main.java', 'DebugProbe');
		const targetLine = result.code.split('\n')[7];
		expect(targetLine).toContain(
			'new java.lang.String[]{"candidate","flag","this","initialized"}'
		);
		expect(targetLine).not.toContain('"uninitialized"');
		expect(targetLine).not.toContain('"conditional"');
		expect(targetLine).not.toContain('"pattern"');
	});

	it('keeps lambda, local-class, and anonymous-class environments separate', () => {
		const source = `class Main {
    void run(int outerParameter) {
        int outer = 3;
        java.util.function.IntUnaryOperator operation = input -> {
            int inner = input + 1;
            return inner;
        };
        class Local { int get(int own) {
            return own;
        } }
        Object object = new Object() { public String toString() {
            return "object";
        } };
        outer++;
    }
}`;
		const lines = instrumentJavaDebugSource(source, 'Main.java', 'DebugProbe').code.split('\n');
		expect(lines[5]).toContain('new java.lang.String[]{"input","inner"}');
		expect(lines[8]).toContain('new java.lang.String[]{"own","this"}');
		expect(lines[11]).toContain('new java.lang.String[]{"this"}');
		expect(lines[11]).toContain(
			'new java.lang.String[]{"this"},new java.lang.Object[]{DebugProbe.capture(this)}'
		);
	});

	it('preserves declarator array dimensions and varargs without interpreting values', () => {
		const source = `class Main {
    static void run(int values[], String... words) {
        int matrix[][] = {{1}};
        var inferred = 4L;
        System.out.print(matrix[0][0]);
    }
}`;
		const line = instrumentJavaDebugSource(source, 'Main.java', 'DebugProbe').code.split(
			'\n'
		)[4];
		expect(line).toContain('new java.lang.String[]{"values","words","matrix","inferred"}');
		expect(line).toContain('new java.lang.String[]{"int[]","String[]","int[][]","var"}');
		expect(line).toContain(
			'new java.lang.Object[]{DebugProbe.capture(values),DebugProbe.capture(words),DebugProbe.capture(matrix),DebugProbe.capture(inferred)}'
		);
	});

	it('does not turn an empty record declaration into an executable method body', () => {
		const source = 'class Main { record Item(int value) {} }';
		expect(instrumentJavaDebugSource(source, 'Main.java', 'DebugProbe')).toEqual({
			code: source,
			locations: []
		});
	});

	it('omits the receiver while evaluating explicit constructor invocation arguments', () => {
		const source = `class Main {
    Main(int input) {
        this(switch(input) { case 0 -> 2; default -> 3; }, 0);
    }
    Main(int input, int ignored) { super(); }
}`;
		const line = instrumentJavaDebugSource(source, 'Main.java', 'DebugProbe').code.split(
			'\n'
		)[2];
		const beforeCompletion = line.slice(0, line.indexOf('}, 0);'));
		expect(beforeCompletion).toContain('new java.lang.String[]{"input"}');
		expect(beforeCompletion).not.toContain('capture(this)');
	});

	it('rejects malformed Java instead of instrumenting parser recovery nodes', () => {
		expect(() =>
			instrumentJavaDebugSource('class Main { void run( { } }', 'Main.java', 'DebugProbe')
		).toThrow(/cannot safely instrument/);
	});

	it('rejects Unicode preprocessing even inside comments', () => {
		expect(() =>
			instrumentJavaDebugSource(
				String.raw`class Main { // \u000a public void run() {}\n }`,
				'Main.java',
				'DebugProbe'
			)
		).toThrow(/Unicode preprocessing/);
	});

	it.each(['DebugProbe;evil()', 'DebugProbe\n', 'bad-name'])(
		'rejects unsafe helper %s',
		(helper) => {
			expect(() => instrumentJavaDebugSource('class Main {}', 'Main.java', helper)).toThrow(
				/Invalid Java debugger helper/
			);
		}
	);

	it('rejects source paths containing line breaks', () => {
		expect(() =>
			instrumentJavaDebugSource('class Main {}', 'Main\n.java', 'DebugProbe')
		).toThrow(/Unsupported Java debug source path/);
	});
});
