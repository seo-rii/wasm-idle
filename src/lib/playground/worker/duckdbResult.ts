import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

// Numeric tags in DuckDB's public tokenizer protocol (TokenType).
const identifierToken = 0,
	operatorToken = 3,
	keywordToken = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const quoteName = (name: string) => '"' + name.replaceAll('"', '""') + '"';

interface Token {
	start: number;
	symbol: string;
}

interface Column {
	name: string;
	type: string;
}

// Read the spelling of structural tokens only. DuckDB's lexer skips comments and
// gives byte offsets for quoted identifiers, dollar strings, and other SQL tokens.
function sqlTokens(
	bytes: Uint8Array,
	offsets: ArrayLike<number>,
	types: ArrayLike<number>
): Token[] {
	return Array.from(offsets, (start, i) => {
		const head = bytes[start];
		let end = start + 1;
		if (head === 58 && (bytes[end] === 58 || bytes[end] === 61)) {
			end++;
		} else if (types[i] === keywordToken) {
			while (end < bytes.length && /[a-z_]/i.test(String.fromCharCode(bytes[end]))) end++;
		}
		const symbol =
			types[i] === keywordToken || types[i] === operatorToken
				? decoder.decode(bytes.subarray(start, end)).toUpperCase()
				: head === 34 || types[i] === identifierToken
					? 'identifier'
					: '';
		return { start, symbol };
	});
}

function nativeText(type: string) {
	return /^(?:TIME(?: WITH TIME ZONE|_NS)?|INTERVAL|UHUGEINT|BIT)$|^(?:STRUCT|MAP|UNION)\(|\[\d*\]$/u.test(
		type
	);
}

const queryStarts = new Set(['SELECT', 'FROM', 'TABLE', 'VALUES', 'PIVOT', 'UNPIVOT']);
const writes = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);
const opens = new Set(['(', '[', '{']);
const closes = new Set([')', ']', '}']);

function topLevel(tokens: Token[]) {
	let depth = 0;
	return tokens.filter(({ symbol }) => {
		if (closes.has(symbol)) depth--;
		const top = depth === 0;
		if (opens.has(symbol)) depth++;
		return top;
	});
}

// An ordinary mutation can publish an arbitrary expression list in RETURNING.
// Its target is the only table whose columns DuckDB binds in that list.
function mutationTarget(
	tokens: Token[],
	verb: string,
	source: (start: number, end: number) => string
) {
	const start =
		verb === 'UPDATE'
			? 1
			: tokens.findIndex(({ symbol }) => symbol === (verb === 'DELETE' ? 'FROM' : 'INTO')) +
				1;
	if (!start || tokens[start]?.symbol !== 'identifier') return;
	let end = start + 1;
	while (tokens[end]?.symbol === '.' && tokens[end + 1]?.symbol === 'identifier') end += 2;
	if (tokens[end]?.symbol === 'AS') end++;
	if (tokens[end]?.symbol === 'identifier') end++;
	if (!tokens[end]) return;
	return source(tokens[start].start, tokens[end].start);
}

function identifier(text: string) {
	return text.startsWith('"')
		? /^"((?:""|[^"])*)"/u.exec(text)?.[1].replaceAll('""', '"')
		: /^[^\s.,()[\]{}:;/*]+/u.exec(text)?.[0];
}

// RETURNING cannot be used as a subquery in DuckDB. Its comma-separated
// expressions are rewritten in place, leaving the mutation and row count intact.
function returningProjection(
	tokens: Token[],
	columns: Column[],
	end: number,
	source: (start: number, end: number) => string
) {
	const commas = topLevel(tokens).filter((token) => token.symbol === ',');
	const terms: Token[][] = [];
	let first = 0;
	for (const comma of commas) {
		const next = tokens.indexOf(comma, first);
		terms.push(tokens.slice(first, next));
		first = next + 1;
	}
	terms.push(tokens.slice(first));
	if (terms.some((term) => !term.length)) return;
	const star = (term: Token[]) =>
		(term.length === 1 && term[0].symbol === '*') ||
		(term.length >= 3 && term.at(-2)?.symbol === '.' && term.at(-1)?.symbol === '*');
	const stars = terms.filter(star).length;
	const starWidth = stars ? (columns.length - terms.length + stars) / stars : 0;
	if (stars ? !Number.isInteger(starWidth) || starWidth < 1 : columns.length !== terms.length)
		return;
	const projection: string[] = [];
	let index = 0;
	for (const [i, term] of terms.entries()) {
		const stop = commas[i]?.start ?? end;
		if (star(term)) {
			for (const column of columns.slice(index, index + starWidth)) {
				const name = quoteName(column.name);
				projection.push(
					nativeText(column.type) ? 'CAST(' + name + ' AS VARCHAR) AS ' + name : name
				);
			}
			index += starWidth;
			continue;
		}
		const column = columns[index++];
		let begin = term[0].start,
			finish = stop;
		if (!nativeText(column.type)) {
			projection.push(source(begin, finish));
			continue;
		}
		const last = term.at(-1)!,
			prev = term.at(-2);
		if (term[1]?.symbol === ':' && identifier(source(begin, term[1].start)) === column.name) {
			begin = term[1].start + 1;
		} else if (prev?.symbol === 'AS') {
			finish = prev.start;
		} else if (
			prev &&
			prev.symbol !== '.' &&
			identifier(source(last.start, finish)) === column.name
		) {
			finish = last.start;
		}
		projection.push(
			'CAST(' + source(begin, finish) + '\n AS VARCHAR) AS ' + quoteName(column.name)
		);
	}
	return projection.join('\n, ');
}

export async function queryDuckDbResult(
	db: Pick<AsyncDuckDB, 'tokenize'>,
	connection: Pick<AsyncDuckDBConnection, 'query'>,
	code: string
) {
	const bytes = encoder.encode(code);
	const source = (start: number, end: number) => decoder.decode(bytes.subarray(start, end));
	const lexed = await db.tokenize(code);
	const tokens = sqlTokens(bytes, lexed.offsets, lexed.types);
	while (tokens.at(-1)?.symbol === ';') tokens.pop();
	if (!tokens.length) return connection.query(code);

	const last = tokens.findLastIndex(({ symbol }) => symbol === ';') + 1;
	const end = lexed.offsets[tokens.length] ?? bytes.length;
	const terms = tokens.slice(last);
	const start = last ? tokens[last - 1].start + 1 : 0;
	const prefix = source(0, start);
	const statement = source(start, end);
	const outer = topLevel(terms);
	const verb =
		outer[0].symbol === 'WITH'
			? outer.find(({ symbol }) => queryStarts.has(symbol) || writes.has(symbol))
			: outer[0];
	if (!verb) return connection.query(code);

	const mutation = writes.has(verb.symbol);
	const returning = mutation ? outer.find(({ symbol }) => symbol === 'RETURNING') : undefined;
	let target: string | undefined;
	if (mutation && returning)
		target = mutationTarget(terms.slice(terms.indexOf(verb)), verb.symbol, source);
	if (mutation ? !target || !returning : !queryStarts.has(verb.symbol) && verb.symbol !== '(')
		return connection.query(code);

	const returned = returning ? terms.slice(terms.indexOf(returning) + 1) : [];
	const describe =
		returning && target
			? 'SELECT ' + source(returning.start + 'RETURNING'.length, end) + '\nFROM ' + target
			: statement;
	// Keep prior statements in the same native parse as the final statement. They
	// execute once. DESCRIBE binds SELECT expressions without running row functions.
	let schema;
	if (mutation) {
		// Parse the original mutation with its prefix before executing any earlier
		// statements. EXPLAIN binds the mutation but never modifies its target.
		if (prefix) await connection.query(prefix + ' EXPLAIN ' + statement + '\n');
		try {
			schema = await connection.query('DESCRIBE ' + describe + '\n');
		} catch {
			// For example, MERGE RETURNING can name its special merge_action column.
			return connection.query(statement);
		}
	} else {
		schema = await connection.query(prefix + ' DESCRIBE ' + describe + '\n');
	}
	const names = schema.getChildAt(0)!,
		types = schema.getChildAt(1)!;
	const columns: Column[] = Array.from({ length: schema.numRows }, (_, i) => ({
		name: String(names.get(i)),
		type: String(types.get(i))
	}));
	if (!columns.some(({ type }) => nativeText(type)))
		return connection.query(prefix ? statement : code);
	if (returning) {
		const projection = returningProjection(returned, columns, end, source);
		if (!projection) return connection.query(statement);
		const rewritten = source(start, returning.start) + 'RETURNING ' + projection;
		// A star modifier or dialect-specific expression may only bind in the
		// original RETURNING list. Choose a plan before executing either mutation.
		try {
			await connection.query('EXPLAIN ' + rewritten);
		} catch {
			return connection.query(statement);
		}
		return connection.query(rewritten);
	}
	// DuckDB deduplicates subquery headings. Positional aliases let us retain
	// both the original names and the distinct values of duplicate columns.
	const aliases = columns.map((_, i) => 'c' + i);
	const projection = columns.map(
		({ name, type }, i) =>
			(nativeText(type) ? 'CAST(' + aliases[i] + ' AS VARCHAR)' : aliases[i]) +
			' AS ' +
			quoteName(name)
	);
	return connection.query(
		'SELECT ' +
			projection.join(', ') +
			' FROM (\n' +
			statement +
			'\n) AS result(' +
			aliases.join(', ') +
			')'
	);
}
