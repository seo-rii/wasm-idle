import type { Pattern } from 'acorn';
import { parseGuestBody } from './guest-syntax.js';

/** Avoid lexical redeclarations without changing native var/function/arguments semantics. */
export function executionParameterNames(code: string, injected: readonly string[]): string[] {
	const { statements } = parseGuestBody(code);
	const lexicalNames = new Set<string>();
	const addBindings = (pattern: Pattern): void => {
		switch (pattern.type) {
			case 'Identifier':
				lexicalNames.add(pattern.name);
				break;
			case 'ArrayPattern':
				for (const element of pattern.elements) if (element) addBindings(element);
				break;
			case 'ObjectPattern':
				for (const property of pattern.properties) {
					addBindings(
						property.type === 'RestElement'
							? property.argument
							: (property.value as Pattern)
					);
				}
				break;
			case 'AssignmentPattern':
				addBindings(pattern.left);
				break;
			case 'RestElement':
				addBindings(pattern.argument);
				break;
		}
	};
	for (const statement of statements) {
		if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
			for (const declaration of statement.declarations) addBindings(declaration.id);
		} else if (statement.type === 'ClassDeclaration' && statement.id) {
			lexicalNames.add(statement.id.name);
		}
	}
	if (!injected.some((name) => lexicalNames.has(name))) return [...injected];

	const identifiers = new Set(injected);
	const sourceText = [code];
	const visit = (value: unknown): void => {
		if (typeof value === 'string') sourceText.push(value);
		else if (value && typeof value === 'object') {
			const node = value as Record<string, unknown>;
			if (node.type === 'Identifier' && typeof node.name === 'string')
				identifiers.add(node.name);
			for (const child of Object.values(node)) visit(child);
		}
	};
	// Include decoded literal text too, so directly evaluated strings cannot
	// accidentally resolve a newly named injected parameter.
	visit(statements);
	let sequence = 0;
	return injected.map((name) => {
		if (!lexicalNames.has(name)) return name;
		let replacement: string;
		do {
			replacement = `__wasmTypeScriptParameter_${sequence++}`;
		} while (
			identifiers.has(replacement) ||
			sourceText.some((text) => text.includes(replacement))
		);
		identifiers.add(replacement);
		return replacement;
	});
}
