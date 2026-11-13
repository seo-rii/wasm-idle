import { FLAG_SKIP_ATTR, read as readJavaClass } from '@katana-project/asm';
import { Modifier } from '@katana-project/asm/spec/modifier';

export type JavaMainInvocation =
	'static-args' | 'instance-args' | 'static-noargs' | 'instance-noargs';

/** Inspect actual javac output: a compatible method reference can also accept Object overloads. */
export function selectJavaMainInvocation(classFile: Uint8Array): JavaMainInvocation {
	const cls = readJavaClass(classFile, FLAG_SKIP_ATTR);
	if (cls.magic !== 0xcafebabe) throw new Error('Invalid Java entry class');
	for (const [descriptor, argumentsKind] of [
		['([Ljava/lang/String;)V', 'args'],
		['()V', 'noargs']
	] as const) {
		const method = cls.methods.find(
			(candidate) =>
				candidate.name.string === 'main' &&
				candidate.type.string === descriptor &&
				(candidate.access & Modifier.PRIVATE) === 0
		);
		if (method) {
			return `${(method.access & Modifier.STATIC) !== 0 ? 'static' : 'instance'}-${argumentsKind}`;
		}
	}
	throw new Error('Main method not found');
}
