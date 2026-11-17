# GraphQL browser execution

`GRAPHQL` (alias `GQL`) executes fresh queries with the official `graphql-js` 17.0.2
reference implementation in a disposable browser Worker. No API server is involved.

The active `.graphql` or `.gql` document may contain both schema SDL and executable
operations. The reference parser separates schema definitions from operations and
fragments before schema construction, validation and execution. If the active document
has no SDL, add `schema.graphql` beside it; the workspace-root `schema.graphql` is the
fallback. Inline SDL takes precedence over the workspace schema file.

For example, use this source:

```graphql
type Query {
	greeting: String!
	numbers: [Int!]!
}

query Example($showNumbers: Boolean! = false) {
	greeting
	numbers @include(if: $showNumbers)
}
```

Set **Preloaded stdin** to a JSON object before clicking **Run**:

```json
{
	"rootValue": { "greeting": "Hello GraphQL!", "numbers": [1, 2, 3] },
	"variables": { "showNumbers": true },
	"operationName": "Example"
}
```

The output is one standard GraphQL JSON result:

```json
{ "data": { "greeting": "Hello GraphQL!", "numbers": [1, 2, 3] } }
```

All input fields are optional; empty stdin means `{}`. `rootValue` and `variables`
must be JSON objects, and `operationName` selects a named operation. Only those
three top-level fields are accepted. The default page example also runs with empty
input, returning the query type and a nullable greeting.

The SDK accepts `options.stdin` as the complete JSON input. Without explicit stdin,
`write()` can supply multiple delayed chunks and `eof()` finishes the document;
execution begins after EOF. Output is buffered as one result, while compile and
validation errors also provide editor diagnostics with the source file and location.

Queries and mutations use JSON data fields as their resolvers. Field arguments do
not automatically filter data or invoke functions. JavaScript resolvers, remote API
requests, subscriptions and program arguments are unsupported. This is a local data
graph executor, rather than a client for an existing GraphQL endpoint.

The Worker is bundled from the exact pinned npm package and covered by a SHA-256
receipt before its JavaScript is executed. `rootUrl` selects the asset root;
`runtimeAssets.graphql.workerUrl` and `workerReceipt` can select another audited bundle.
Regenerate only this runtime with `pnpm sync:wasm-graphql`; verify the committed
bundle with `node scripts/sync-wasm-graphql.mjs --check`.
