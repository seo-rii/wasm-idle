import {
	GraphQLError,
	Kind,
	Source,
	buildASTSchema,
	executeSync,
	getOperationAST,
	parse,
	validate,
	type DocumentNode,
	type ExecutionResult
} from 'graphql';

export interface GraphqlRunInput {
	code: string;
	activePath?: string;
	workspaceFiles?: Array<{ path: string; content: string }>;
	stdin?: string;
	args?: string[];
}

export interface GraphqlRunResult {
	result: ExecutionResult;
	diagnostics: Array<{
		fileName: string;
		lineNumber: number;
		columnNumber: number;
		severity: 'error';
		message: string;
	}>;
	ok: boolean;
}

function inputObject(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new GraphQLError(`${name} must be a JSON object.`);
	}
	return value as Record<string, unknown>;
}

function parseInput(stdin: string | undefined) {
	let input: Record<string, unknown> = {};
	if (stdin?.trim()) {
		try {
			input = inputObject(JSON.parse(stdin), 'GraphQL stdin');
		} catch (error) {
			throw new GraphQLError(`Invalid GraphQL JSON input: ${String(error)}`);
		}
	}
	for (const key of Object.keys(input)) {
		if (!['rootValue', 'variables', 'operationName'].includes(key)) {
			throw new GraphQLError(`Unknown GraphQL input field: ${key}.`);
		}
	}
	const variables =
		input.variables === undefined ? {} : inputObject(input.variables, 'variables');
	const rootValue =
		input.rootValue === undefined ? {} : inputObject(input.rootValue, 'rootValue');
	if (input.operationName !== undefined && typeof input.operationName !== 'string') {
		throw new GraphQLError('operationName must be a string.');
	}
	return { variables, rootValue, operationName: input.operationName as string | undefined };
}

/** Execute the real GraphQL reference implementation against a local JSON data graph. */
export function executeGraphql(
	request: GraphqlRunInput,
	onExecutionReady: () => void = () => undefined
): GraphqlRunResult {
	const activePath = request.activePath || 'main.graphql';
	let errors: readonly GraphQLError[] = [];
	let result: ExecutionResult;
	try {
		if (request.args?.length) {
			throw new GraphQLError('GraphQL does not accept program arguments; use JSON stdin.');
		}
		const input = parseInput(request.stdin);
		const parsed = parse(new Source(request.code, activePath));
		const executable: DocumentNode = {
			kind: Kind.DOCUMENT,
			definitions: parsed.definitions.filter(
				(definition) =>
					definition.kind === Kind.OPERATION_DEFINITION ||
					definition.kind === Kind.FRAGMENT_DEFINITION
			)
		};
		let schemaDocument: DocumentNode = {
			kind: Kind.DOCUMENT,
			definitions: parsed.definitions.filter(
				(definition) =>
					definition.kind !== Kind.OPERATION_DEFINITION &&
					definition.kind !== Kind.FRAGMENT_DEFINITION
			)
		};
		if (!schemaDocument.definitions.length) {
			const directory = activePath.includes('/')
				? activePath.slice(0, activePath.lastIndexOf('/') + 1)
				: '';
			const schemaFile =
				request.workspaceFiles?.find(
					(file) => file.path === `${directory}schema.graphql`
				) || request.workspaceFiles?.find((file) => file.path === 'schema.graphql');
			if (!schemaFile) {
				throw new GraphQLError(
					'GraphQL schema missing: include SDL in the source or add schema.graphql to the workspace.'
				);
			}
			schemaDocument = parse(new Source(schemaFile.content, schemaFile.path));
		}
		const schema = buildASTSchema(schemaDocument);
		errors = validate(schema, executable);
		if (errors.length) {
			result = { errors };
		} else {
			const operation = getOperationAST(executable, input.operationName);
			if (operation?.operation === 'subscription') {
				throw new GraphQLError(
					'GraphQL subscriptions require a live event source and are unsupported.'
				);
			}
			onExecutionReady();
			result = executeSync({
				schema,
				document: executable,
				rootValue: input.rootValue,
				variableValues: input.variables,
				operationName: input.operationName,
				// JSON input is data, never executable resolvers or inherited Object methods.
				fieldResolver(source, _args, _context, info) {
					return source !== null &&
						typeof source === 'object' &&
						Object.hasOwn(source, info.fieldName)
						? source[info.fieldName]
						: undefined;
				}
			});
			errors = result.errors || [];
		}
	} catch (error) {
		errors = [error instanceof GraphQLError ? error : new GraphQLError(String(error))];
		result = { errors };
	}
	return {
		result,
		ok: errors.length === 0,
		diagnostics: errors.flatMap((error) => {
			const fileName = error.source?.name || error.nodes?.[0]?.loc?.source.name || activePath;
			return (error.locations?.length ? error.locations : [{ line: 1, column: 1 }]).map(
				(location) => ({
					fileName,
					lineNumber: location.line,
					columnNumber: location.column,
					severity: 'error' as const,
					message: error.message
				})
			);
		})
	};
}
