import { getLineInfo, parse, type Position, type Program } from 'acorn';

const bodyPrefix = 'async function __wasmTypeScriptGuest() {\n';

export class GuestSyntaxError extends SyntaxError {
	readonly loc: Position;

	constructor(message: string, code: string, position: number) {
		const loc = getLineInfo(code, Math.max(0, Math.min(code.length, position)));
		super(`${message} (${loc.line}:${loc.column})`);
		this.loc = loc;
	}
}

/** Parse the runner's async function grammar and retain original source coordinates. */
export function parseGuestBody(code: string) {
	const wrapped = `${bodyPrefix}${code}\n}`;
	let program: Program;
	try {
		program = parse(wrapped, {
			ecmaVersion: 'latest',
			sourceType: 'script',
			allowImportExportEverywhere: true,
			locations: true
		});
	} catch (error) {
		if (error instanceof SyntaxError) {
			const position = (error as SyntaxError & { pos?: unknown }).pos;
			if (typeof position === 'number') {
				throw new GuestSyntaxError(
					error.message.replace(/ \(\d+:\d+\)$/u, ''),
					code,
					position - bodyPrefix.length
				);
			}
		}
		throw error;
	}
	const guest = program.body[0];
	if (
		program.body.length !== 1 ||
		guest?.type !== 'FunctionDeclaration' ||
		guest.body.end !== wrapped.length
	) {
		// Source must not close the synthetic function and introduce sibling nodes.
		const end = guest?.type === 'FunctionDeclaration' ? guest.body.end : bodyPrefix.length;
		throw new GuestSyntaxError('Unexpected closing brace', code, end - bodyPrefix.length - 1);
	}
	return {
		// Acorn's import extension also permits module declarations in this body.
		statements: guest.body.body as Program['body'],
		offset: bodyPrefix.length,
		lineOffset: 1
	};
}
