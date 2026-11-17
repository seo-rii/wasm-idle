// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { executeGraphql } from '../../../scripts/runtime-workers/graphql-execution';
import { editorDefaults } from '../../routes/editor-defaults';

const source = `type Item { name: String!, value: Int! }
type Query { greeting: String!, items: [Item!]! }
query Values($show: Boolean! = true) {
  alias: greeting
  items @include(if: $show) { ...Fields }
}
fragment Fields on Item { name value }`;
const stdin = JSON.stringify({
	rootValue: { greeting: '안녕', items: [{ name: 'first', value: 42 }] }
});

describe('official GraphQL execution', () => {
	it('parses SDL and executes aliases, fragments, directives and JSON data with graphql-js', () => {
		const ready = vi.fn();
		expect(executeGraphql({ code: source, stdin }, ready)).toMatchObject({
			ok: true,
			result: { data: { alias: '안녕', items: [{ name: 'first', value: 42 }] } },
			diagnostics: []
		});
		expect(ready).toHaveBeenCalledOnce();
		expect(
			executeGraphql({
				code: source,
				stdin: JSON.stringify({ rootValue: { greeting: 'x' }, variables: { show: false } })
			}).result
		).toEqual({ data: { alias: 'x' } });
	});

	it('loads the adjacent workspace schema before the root schema', () => {
		const outcome = executeGraphql({
			code: '{ number }',
			activePath: 'queries/main.graphql',
			workspaceFiles: [
				{ path: 'schema.graphql', content: 'type Query { wrong: String }' },
				{ path: 'queries/schema.graphql', content: 'type Query { number: Int }' }
			],
			stdin: '{"rootValue":{"number":123}}'
		});
		expect(outcome.result).toEqual({ data: { number: 123 } });
	});

	it('reports original query and schema locations through reference parser diagnostics', () => {
		const queryError = executeGraphql({
			code: 'type Query { x: Int }\n{ missing }',
			activePath: 'query.gql'
		});
		expect(queryError.ok).toBe(false);
		expect(queryError.diagnostics[0]).toMatchObject({
			fileName: 'query.gql',
			lineNumber: 2,
			columnNumber: 3
		});
		const schemaError = executeGraphql({
			code: '{ x }',
			workspaceFiles: [{ path: 'schema.graphql', content: 'type Query { x: }' }]
		});
		expect(schemaError.diagnostics[0]).toMatchObject({
			fileName: 'schema.graphql',
			lineNumber: 1
		});
	});

	it.each([
		'[1]',
		'{',
		'{"variables":[]}',
		'{"rootValue":null}',
		'{"operationName":42}',
		'{"typo":true}'
	])('rejects malformed or ambiguous JSON input: %s', (invalid) => {
		expect(executeGraphql({ code: source, stdin: invalid }).ok).toBe(false);
	});

	it('selects named operations and returns ordinary GraphQL partial-data errors', () => {
		const code = 'type Query { x: Int!, y: Int } query X { x } query Y { y }';
		expect(
			executeGraphql({ code, stdin: '{"operationName":"Y","rootValue":{"y":7}}' }).result
		).toEqual({ data: { y: 7 } });
		const missing = executeGraphql({ code, stdin: '{"operationName":"X"}' });
		expect(missing.ok).toBe(false);
		expect(missing.result.data).toBeNull();
	});

	it('does not invoke Object prototype methods from JSON data', () => {
		const result = executeGraphql({
			code: 'type Query { toString: String } { toString }',
			stdin: '{}'
		});
		expect(result.result).toEqual({ data: { toString: null } });
	});

	it('runs the page sample with empty stdin and exposes the intended optional input', () => {
		expect(executeGraphql({ code: editorDefaults.graphql, stdin: '' }).result).toEqual({
			data: { __typename: 'Query', greeting: null }
		});
		expect(
			executeGraphql({
				code: editorDefaults.graphql,
				stdin: '{"rootValue":{"greeting":"Hello GraphQL!","numbers":[1,2,3]},"variables":{"showNumbers":true}}'
			}).result
		).toEqual({
			data: { __typename: 'Query', greeting: 'Hello GraphQL!', numbers: [1, 2, 3] }
		});
	});

	it('rejects subscriptions, missing schemas and unsupported program arguments', () => {
		expect(executeGraphql({ code: '{ x }' }).diagnostics[0].message).toContain(
			'schema missing'
		);
		expect(
			executeGraphql({
				code: 'type Query { x: Int } type Subscription { tick: Int } subscription { tick }'
			}).diagnostics[0].message
		).toContain('subscriptions');
		expect(executeGraphql({ code: source, args: ['--server'] }).ok).toBe(false);
	});
});
