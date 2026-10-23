import { lexAndParse, type CstNode, type IToken } from 'java-parser';

export interface JavaDebugEvaluationBinding {
	name: string;
	type: string;
	/** Raw Java value text; char is a decimal UTF-16 code unit, String is unquoted. */
	value: string | null;
	unavailable?: string;
}

export interface JavaDebugEvaluationRequest {
	expression: string;
	bindings: readonly JavaDebugEvaluationBinding[];
}

const primitiveTypes = new Set([
	'boolean',
	'byte',
	'short',
	'char',
	'int',
	'long',
	'float',
	'double'
]);
const stringMethods = new Set([
	'length',
	'isEmpty',
	'isBlank',
	'charAt',
	'codePointAt',
	'codePointBefore',
	'codePointCount',
	'compareTo',
	'compareToIgnoreCase',
	'equals',
	'equalsIgnoreCase',
	'contains',
	'startsWith',
	'endsWith',
	'indexOf',
	'lastIndexOf',
	'substring',
	'subSequence',
	'trim',
	'strip',
	'stripLeading',
	'stripTrailing',
	'concat',
	'hashCode',
	'toString',
	'regionMatches'
]);
const stringReturningMethods = new Set([
	'substring',
	'subSequence',
	'trim',
	'strip',
	'stripLeading',
	'stripTrailing',
	'concat',
	'toString',
	'valueOf',
	'toHexString',
	'toOctalString',
	'toBinaryString',
	'toUnsignedString'
]);
const staticMethods: Record<string, ReadonlySet<string>> = {
	Math: new Set([
		'abs',
		'min',
		'max',
		'round',
		'ceil',
		'floor',
		'sqrt',
		'cbrt',
		'pow',
		'sin',
		'cos',
		'tan',
		'asin',
		'acos',
		'atan',
		'atan2',
		'exp',
		'expm1',
		'log',
		'log10',
		'log1p',
		'hypot',
		'signum',
		'copySign',
		'scalb',
		'ulp',
		'nextUp',
		'nextDown',
		'nextAfter',
		'toRadians',
		'toDegrees',
		'addExact',
		'subtractExact',
		'multiplyExact',
		'toIntExact',
		'floorDiv',
		'floorMod',
		'IEEEremainder'
	]),
	String: new Set(['valueOf']),
	Integer: new Set([
		'parseInt',
		'parseUnsignedInt',
		'toString',
		'toHexString',
		'toOctalString',
		'toBinaryString',
		'toUnsignedString',
		'compare',
		'compareUnsigned',
		'sum',
		'min',
		'max',
		'bitCount',
		'signum',
		'numberOfLeadingZeros',
		'numberOfTrailingZeros',
		'reverse',
		'reverseBytes',
		'rotateLeft',
		'rotateRight',
		'highestOneBit',
		'lowestOneBit',
		'toUnsignedLong'
	]),
	Long: new Set([
		'parseLong',
		'parseUnsignedLong',
		'toString',
		'toHexString',
		'toOctalString',
		'toBinaryString',
		'toUnsignedString',
		'compare',
		'compareUnsigned',
		'sum',
		'min',
		'max',
		'bitCount',
		'signum',
		'numberOfLeadingZeros',
		'numberOfTrailingZeros',
		'reverse',
		'reverseBytes',
		'rotateLeft',
		'rotateRight',
		'highestOneBit',
		'lowestOneBit'
	]),
	Double: new Set([
		'parseDouble',
		'toString',
		'isNaN',
		'isInfinite',
		'isFinite',
		'compare',
		'sum',
		'min',
		'max'
	]),
	Float: new Set([
		'parseFloat',
		'toString',
		'isNaN',
		'isInfinite',
		'isFinite',
		'compare',
		'sum',
		'min',
		'max'
	]),
	Boolean: new Set(['parseBoolean', 'toString', 'logicalAnd', 'logicalOr', 'logicalXor']),
	Character: new Set([
		'isDigit',
		'isLetter',
		'isLetterOrDigit',
		'isWhitespace',
		'isUpperCase',
		'isLowerCase',
		'toUpperCase',
		'toLowerCase',
		'toTitleCase',
		'getNumericValue',
		'digit',
		'toString'
	])
};
const constants: Record<string, ReadonlySet<string>> = {
	Math: new Set(['PI', 'E']),
	Integer: new Set(['MIN_VALUE', 'MAX_VALUE', 'SIZE', 'BYTES']),
	Long: new Set(['MIN_VALUE', 'MAX_VALUE', 'SIZE', 'BYTES']),
	Short: new Set(['MIN_VALUE', 'MAX_VALUE', 'SIZE', 'BYTES']),
	Byte: new Set(['MIN_VALUE', 'MAX_VALUE', 'SIZE', 'BYTES']),
	Character: new Set(['MIN_VALUE', 'MAX_VALUE', 'SIZE', 'BYTES']),
	Double: new Set([
		'MIN_VALUE',
		'MIN_NORMAL',
		'MAX_VALUE',
		'NaN',
		'POSITIVE_INFINITY',
		'NEGATIVE_INFINITY'
	]),
	Float: new Set([
		'MIN_VALUE',
		'MIN_NORMAL',
		'MAX_VALUE',
		'NaN',
		'POSITIVE_INFINITY',
		'NEGATIVE_INFINITY'
	])
};
type ValueKind = 'scalar' | 'string' | 'null';

const nodes = (node: CstNode, key: string): CstNode[] =>
	(node.children[key] ?? []).flatMap<CstNode>((child) => ('children' in child ? [child] : []));
const tokens = (node: CstNode, key: string) =>
	(node.children[key] ?? []).filter((child): child is IToken => !('children' in child));

function identifiers(node: CstNode): IToken[] {
	return Object.entries(node.children)
		.flatMap(([key, children]) =>
			children.flatMap((child) =>
				'children' in child ? identifiers(child) : key === 'Identifier' ? [child] : []
			)
		)
		.sort((a, b) => a.startOffset - b.startOffset);
}

/** Validate the upstream CST; javac, not this code, determines and executes Java semantics. */
function validateExpression(expression: string, bindings: Map<string, JavaDebugEvaluationBinding>) {
	const referenced = new Set<string>();
	if (/\\u+[0-9a-fA-F]{4}/.test(expression))
		throw new Error('Java evaluation does not support Unicode preprocessing escapes.');
	const { cst, tokens: expressionTokens } = lexAndParse(expression, 'expression');
	const forbidden = new Set([
		'PlusPlus',
		'MinusMinus',
		'New',
		'This',
		'Super',
		'Arrow',
		'DoubleColon',
		'LSquare',
		'LCurly',
		'Class',
		'Instanceof',
		'At'
	]);
	if (expressionTokens.some((token) => forbidden.has(token.tokenType.name)))
		throw new Error(
			'Java evaluation supports read-only scalar/String expressions; mutation, objects, arrays and closures are unsupported.'
		);
	const kinds = new Map<CstNode, ValueKind>();
	const visit = (node: CstNode): ValueKind => {
		if (kinds.has(node)) return kinds.get(node)!;
		if (node.children.AssignmentOperator)
			throw new Error('Java evaluation does not allow assignment or mutation.');
		if (node.name === 'conditionalExpression' && node.children.QuestionMark)
			throw new Error(
				'Java snapshot evaluation does not support conditional expressions because compile-time constant narrowing is unavailable.'
			);
		if (node.name === 'typeArguments')
			throw new Error('Java evaluation does not support generic or user-type expressions.');
		const children = Object.values(node.children)
			.flat()
			.flatMap<CstNode>((child) => ('children' in child ? [child] : []));
		const childKinds = children.map(visit);
		let kind: ValueKind = childKinds.includes('string')
			? 'string'
			: childKinds.includes('null')
				? 'null'
				: 'scalar';
		if (node.name === 'literal') {
			kind =
				node.children.StringLiteral || node.children.TextBlock
					? 'string'
					: node.children.Null
						? 'null'
						: 'scalar';
		} else if (node.name === 'referenceTypeCastExpression') {
			const type = identifiers(nodes(node, 'referenceType')[0])
				.map((token) => token.image)
				.join('.');
			if (type !== 'java.lang.String')
				throw new Error(
					'Java evaluation supports only primitive and fully qualified java.lang.String casts.'
				);
			kind = 'string';
		} else if (node.name === 'primitiveCastExpression') {
			kind = 'scalar';
		} else if (node.name === 'primary') {
			const prefix = nodes(node, 'primaryPrefix')[0];
			const qualified = nodes(prefix, 'fqnOrRefType')[0];
			const suffixes = nodes(node, 'primarySuffix');
			let firstSuffix = 0;
			if (qualified) {
				const parts = identifiers(qualified).map((token) => token.image);
				const called = Boolean(suffixes[0]?.children.methodInvocationSuffix);
				const binding = bindings.get(parts[0]);
				if (binding) {
					if (binding.unavailable !== undefined)
						throw new Error(
							`Java evaluation cannot use ${binding.name}: ${binding.unavailable}`
						);
					if (
						!primitiveTypes.has(binding.type) &&
						binding.type !== 'String' &&
						binding.type !== 'java.lang.String'
					)
						throw new Error(
							`Java evaluation cannot use ${binding.name} (${binding.type}); inspect this target reference in Variables.`
						);
					referenced.add(binding.name);
					kind = primitiveTypes.has(binding.type) ? 'scalar' : 'string';
					if (parts.length !== 1 || called) {
						if (
							parts.length !== 2 ||
							!called ||
							kind !== 'string' ||
							!stringMethods.has(parts[1])
						)
							throw new Error(
								'Java evaluation cannot call target methods or access target fields.'
							);
						kind = stringReturningMethods.has(parts[1]) ? 'string' : 'scalar';
						firstSuffix = 1;
					}
				} else {
					const path = parts.slice(2);
					if (
						parts[0] !== 'java' ||
						parts[1] !== 'lang' ||
						path.length !== 2 ||
						(called
							? !Object.hasOwn(staticMethods, path[0]) ||
								!staticMethods[path[0]].has(path[1])
							: !Object.hasOwn(constants, path[0]) ||
								!constants[path[0]].has(path[1]))
					)
						throw new Error(
							`Java evaluation cannot resolve ${parts.join('.')}; use scalar/String locals or fully qualified java.lang library calls/constants.`
						);
					kind = called && stringReturningMethods.has(path[1]) ? 'string' : 'scalar';
					firstSuffix = called ? 1 : 0;
				}
			}
			for (let index = firstSuffix; index < suffixes.length; index += 2) {
				const name = tokens(suffixes[index], 'Identifier')[0]?.image;
				if (
					kind !== 'string' ||
					!name ||
					!stringMethods.has(name) ||
					!suffixes[index + 1]?.children.methodInvocationSuffix
				)
					throw new Error(
						'Java evaluation supports only approved String methods on expression results.'
					);
				kind = stringReturningMethods.has(name) ? 'string' : 'scalar';
			}
		} else if (node.name === 'binaryExpression') {
			const operands = nodes(node, 'unaryExpression').map(visit);
			const operators = tokens(node, 'BinaryOperator');
			for (const [index, operator] of operators.entries()) {
				const comparesNull = [index, index + 1].some(
					(position) =>
						operands[position] === 'null' &&
						operators[position - 1]?.image !== '+' &&
						operators[position]?.image !== '+'
				);
				if (
					['==', '!='].includes(operator.image) &&
					(operands[index] === 'string' || operands[index + 1] === 'string') &&
					!comparesNull
				)
					throw new Error(
						'Java snapshot evaluation cannot compare String reference identity; use equals() for String contents.'
					);
			}
			if (
				operators.some((token) =>
					['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(token.image)
				)
			)
				kind = 'scalar';
		}
		kinds.set(node, kind);
		return kind;
	};
	visit(cst);
	return referenced;
}

/** A standalone program; no user classes, initializers or main method are copied into it. */
export function buildJavaDebugEvaluationProgram(request: JavaDebugEvaluationRequest): {
	code: string;
	args: string[];
} {
	if (
		typeof request.expression !== 'string' ||
		!request.expression.trim() ||
		new TextEncoder().encode(request.expression).length > 4096
	)
		throw new Error('Java expressions must contain 1–4096 UTF-8 bytes.');
	if (!Array.isArray(request.bindings) || request.bindings.length > 1024)
		throw new Error('Java evaluation supports at most 1024 local bindings.');
	const bindings = new Map<string, JavaDebugEvaluationBinding>();
	for (const binding of request.bindings) {
		if (
			!binding ||
			typeof binding.name !== 'string' ||
			typeof binding.type !== 'string' ||
			(binding.value !== null && typeof binding.value !== 'string') ||
			(binding.unavailable !== undefined && typeof binding.unavailable !== 'string')
		)
			throw new Error('Invalid Java evaluation binding.');
		const parsed = lexAndParse(binding.name, 'expression');
		if (
			parsed.tokens.length !== 1 ||
			identifiers(parsed.cst)[0]?.image !== binding.name ||
			bindings.has(binding.name) ||
			/\\/.test(binding.name)
		)
			throw new Error(`Invalid or duplicate Java local name: ${binding.name}`);
		bindings.set(binding.name, { ...binding });
	}
	const referenced = validateExpression(request.expression, bindings);
	let stem: string;
	do {
		stem = `WasmIdleEval_${crypto.randomUUID().replaceAll('-', '')}`;
	} while (
		request.expression.includes(stem) ||
		[...bindings.keys()].some((name) => name.includes(stem))
	);
	const argumentName = `${stem}_args`;
	const args: string[] = [];
	const declarations: string[] = [];
	const decoders: Record<string, string> = {
		byte: 'java.lang.Byte.parseByte(value)',
		short: 'java.lang.Short.parseShort(value)',
		int: 'java.lang.Integer.parseInt(value)',
		long: 'java.lang.Long.parseLong(value)',
		// The pinned TeaVM parser rejects NaN/Infinity. Restore captured special values
		// through genuine Java constants/bit conversion instead of parsing those spellings.
		float: 'value.equals("NaN") ? java.lang.Float.NaN : value.equals("Infinity") ? java.lang.Float.POSITIVE_INFINITY : value.equals("-Infinity") ? java.lang.Float.NEGATIVE_INFINITY : value.equals("-0.0") ? java.lang.Float.intBitsToFloat(java.lang.Integer.MIN_VALUE) : java.lang.Float.parseFloat(value)',
		double: 'value.equals("NaN") ? java.lang.Double.NaN : value.equals("Infinity") ? java.lang.Double.POSITIVE_INFINITY : value.equals("-Infinity") ? java.lang.Double.NEGATIVE_INFINITY : value.equals("-0.0") ? java.lang.Double.longBitsToDouble(java.lang.Long.MIN_VALUE) : java.lang.Double.parseDouble(value)',
		boolean: 'java.lang.Boolean.parseBoolean(value)',
		char: '(char) java.lang.Integer.parseInt(value)'
	};
	let inputBytes = 0;
	for (const binding of bindings.values()) {
		if (!referenced.has(binding.name)) continue;
		inputBytes += new TextEncoder().encode(binding.value ?? '').length;
		if (inputBytes > 65_536)
			throw new Error('Java evaluation binding values exceed 65536 UTF-8 bytes.');
		const index = args.length;
		if (primitiveTypes.has(binding.type)) {
			if (
				binding.value === null ||
				(binding.type === 'char' &&
					(!/^\d{1,5}$/.test(binding.value) || Number(binding.value) > 65535)) ||
				(binding.type === 'boolean' && !['true', 'false'].includes(binding.value))
			)
				throw new Error(`Invalid ${binding.type} value for Java local ${binding.name}.`);
			args.push(binding.value);
			declarations.push(
				`final ${binding.type} ${binding.name} = ${stem}_${binding.type}(${argumentName}[${index}]);`
			);
		} else if (binding.type === 'String' || binding.type === 'java.lang.String') {
			args.push(binding.value === null ? '1' : '0', binding.value ?? '');
			declarations.push(
				`final java.lang.String ${binding.name} = ${argumentName}[${index}].equals("1") ? null : ${argumentName}[${index + 1}];`
			);
		}
	}
	return {
		args,
		code: `public final class ${stem} {
${Object.entries(decoders)
	.map(
		([type, body]) =>
			`    private static ${type} ${stem}_${type}(java.lang.String value) { return ${body}; }`
	)
	.join('\n')}
${String.raw`    private static java.lang.String ${stem}_quote(java.lang.String value) {
        java.lang.StringBuilder result = new java.lang.StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '"': result.append("\\\""); break;
                case '\\': result.append("\\\\"); break;
                case '\b': result.append("\\b"); break;
                case '\f': result.append("\\f"); break;
                case '\n': result.append("\\n"); break;
                case '\r': result.append("\\r"); break;
                case '\t': result.append("\\t"); break;
                default:
                    if (ch < 32 || java.lang.Character.isSurrogate(ch)) {
                        java.lang.String hex = java.lang.Integer.toHexString(ch);
                        result.append("\\u");
                        for (int pad = hex.length(); pad < 4; pad++) result.append('0');
                        result.append(hex);
                    } else result.append(ch);
            }
        }
        return result.append('"').toString();
    }`}
    private static void ${stem}_print(java.lang.Object value) {
        if (value != null && !(value instanceof java.lang.String) && !(value instanceof java.lang.Number)
                && !(value instanceof java.lang.Boolean) && !(value instanceof java.lang.Character))
            throw new java.lang.IllegalArgumentException("Java evaluation result is not a scalar or String.");
        java.lang.String text = java.lang.String.valueOf(value);
        if (value instanceof java.lang.String || value instanceof java.lang.Character) text = ${stem}_quote(text);
        if (text.length() > 16384) throw new java.lang.IllegalArgumentException("Java evaluation output exceeds 16384 characters.");
        java.lang.System.out.print(text);
    }
    public static void main(java.lang.String[] ${argumentName}) {
${declarations.map((line) => `        ${line}`).join('\n')}
        ${stem}_print((${request.expression}\n));
    }
}\n`
	};
}
