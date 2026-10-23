// @vitest-environment node

import { parse } from 'java-parser';
import { describe, expect, it } from 'vitest';
import {
	buildJavaDebugEvaluationProgram,
	type JavaDebugEvaluationBinding
} from './worker/javaDebugEvaluator';

const bindings: JavaDebugEvaluationBinding[] = [
	{ name: 'number', type: 'int', value: '7' },
	{ name: 'text', type: 'java.lang.String', value: 'hello' },
	{ name: 'other', type: 'String', value: 'hello' },
	{ name: 'array', type: 'int[]', value: null },
	{
		name: 'object',
		type: 'Main',
		value: null,
		unavailable: 'Target object references are not copied.'
	}
];

describe('Java compiler-backed evaluation program', () => {
	it.each([
		'number * 2 + 1',
		'java.lang.Integer.MAX_VALUE + 1',
		'java.lang.Math.max(number, 9)',
		'java.lang.Math.sqrt(9)',
		"java.lang.Character.toUpperCase('a') == 'A'",
		'(long)number << 40',
		'text.substring(1).length()',
		'text.length() == 5',
		'text.equals(other)',
		'text == null',
		'text + number',
		'"abc".charAt(1)',
		'(java.lang.String)null',
		'(text + "!").length()',
		'1 /* no code */ + 2 // trailing comment'
	])('accepts a complete read-only Java expression: %s', (expression) => {
		const program = buildJavaDebugEvaluationProgram({ expression, bindings });
		expect(() => parse(program.code)).not.toThrow();
	});

	it.each([
		'number = 1',
		'number += 1',
		'number <<= 1',
		'++number',
		'number--',
		'array[0]',
		'object.field',
		'object.toString()',
		'text.intern()',
		'text.getClass()',
		'text.repeat(1000000000)',
		'System.out.println(number)',
		'System.exit(0)',
		'helper(number)',
		'Math.random()',
		'new String("x")',
		'() -> number',
		'String.class',
		'String::valueOf',
		'text == other',
		'text != "hello"',
		'text == null + other',
		'number > 0 ? number : -number',
		'text.toUpperCase()',
		'"i".toLowerCase()',
		'Math.abs(number)',
		'Integer.MAX_VALUE',
		'String.valueOf(number)',
		'(String)null',
		'number; System.exit(0)',
		'1); } static { System.exit(0); } //',
		String.raw`number \u002b 1`,
		'(Object)text'
	])('rejects unsupported semantics before compiler execution: %s', (expression) => {
		expect(() => buildJavaDebugEvaluationProgram({ expression, bindings })).toThrow();
	});

	it('rejects conditional narrowing whose result would change after snapshot transport', () => {
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: 'java.lang.String.valueOf(pick ? value : unit)',
				bindings: [
					{ name: 'pick', type: 'boolean', value: 'true' },
					{ name: 'value', type: 'int', value: '65' },
					{ name: 'unit', type: 'char', value: '66' }
				]
			})
		).toThrow('compile-time constant narrowing');
	});

	it('passes hostile String contents only as runtime arguments', () => {
		const value = '"\n); System.exit(0); //\\u000a\u0000';
		const program = buildJavaDebugEvaluationProgram({
			expression: 'text',
			bindings: [{ name: 'text', type: 'String', value }]
		});
		expect(program.args).toEqual(['0', value]);
		expect(program.code).not.toContain(value);
		expect(() => parse(program.code)).not.toThrow();
	});

	it('keeps genuine null separate from unavailable target data', () => {
		const program = buildJavaDebugEvaluationProgram({
			expression: 'text',
			bindings: [{ name: 'text', type: 'String', value: null }]
		});
		expect(program.args).toEqual(['1', '']);
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: 'text',
				bindings: [
					{
						name: 'text',
						type: 'String',
						value: null,
						unavailable: 'String exceeds the value limit.'
					}
				]
			})
		).toThrow('String exceeds the value limit');
	});

	it('does not let unrelated references or unavailable values block scalar expressions', () => {
		const program = buildJavaDebugEvaluationProgram({
			expression: 'number + 1',
			bindings: [
				...bindings,
				{ name: 'large', type: 'String', value: null, unavailable: 'Too large' },
				{ name: 'missing', type: 'int', value: null, unavailable: 'Uninitialized' }
			]
		});
		expect(program.args).toEqual(['7']);
		expect(program.code).not.toContain('final java.lang.String large');
	});

	it('keeps exact long values and decimal UTF-16 chars out of source literals', () => {
		const program = buildJavaDebugEvaluationProgram({
			expression: 'wide + unit',
			bindings: [
				{ name: 'wide', type: 'long', value: '9007199254740993' },
				{ name: 'unit', type: 'char', value: '65535' }
			]
		});
		expect(program.args).toEqual(['9007199254740993', '65535']);
		expect(program.code).not.toContain('9007199254740993');
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: 'unit',
				bindings: [{ name: 'unit', type: 'char', value: '65536' }]
			})
		).toThrow('Invalid char value');
	});

	it('accepts Unicode and contextual-keyword Java local names without confusing helper names', () => {
		const program = buildJavaDebugEvaluationProgram({
			expression: '값 + record + java + String',
			bindings: [
				{ name: '값', type: 'int', value: '1' },
				{ name: 'record', type: 'int', value: '2' },
				{ name: 'java', type: 'int', value: '3' },
				{ name: 'String', type: 'int', value: '4' }
			]
		});
		expect(() => parse(program.code)).not.toThrow();
	});

	it('rejects duplicate or injected local declarations and oversized requests', () => {
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: 'number',
				bindings: [bindings[0], bindings[0]]
			})
		).toThrow('duplicate');
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: '1',
				bindings: [{ name: 'x; System.exit(0)', type: 'int', value: '1' }]
			})
		).toThrow();
		expect(() =>
			buildJavaDebugEvaluationProgram({ expression: '1'.repeat(4097), bindings: [] })
		).toThrow('4096');
		expect(() =>
			buildJavaDebugEvaluationProgram({
				expression: 'text',
				bindings: [{ name: 'text', type: 'String', value: 'a'.repeat(65537) }]
			})
		).toThrow('65536');
	});
});
