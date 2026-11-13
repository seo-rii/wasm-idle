import { describe, expect, it } from 'vitest';
import { resolveJavaSourceIdentity } from './javaSource';

describe('Java source file identity', () => {
	it('uses Main.java for compact source without a supplied filename', () => {
		expect(resolveJavaSourceIdentity('void main() { IO.println("hello"); }')).toEqual({
			mainClass: 'Main',
			sourcePath: 'Main.java'
		});
	});

	it('uses the supplied filename for an implicit class', () => {
		expect(resolveJavaSourceIdentity('void main() {}', 'lessons/Hello.java')).toEqual({
			mainClass: 'Hello',
			sourcePath: 'lessons/Hello.java'
		});
	});

	it('retains declared public type and package defaults', () => {
		expect(resolveJavaSourceIdentity('package demo;\npublic class Entry {}')).toEqual({
			mainClass: 'demo.Entry',
			sourcePath: 'demo/Entry.java'
		});
	});
});
