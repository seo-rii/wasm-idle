import { describe, expect, it } from 'vitest';
import { instrumentJavaDebugSource } from './javaDebugSource';

describe('Java source debug instrumentation', () => {
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
		expect(transformed.code).toContain('DebugProbe.hit("example/Main.java",3,9);');
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
