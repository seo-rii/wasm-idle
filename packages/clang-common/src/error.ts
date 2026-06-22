export class ProcExit extends Error {
	code: number;

	constructor(code: number) {
		super(`process exited with code ${code}.`);
		this.code = code;
	}
}

export class NotImplemented extends Error {
	constructor(modname: any, fieldname: any) {
		super(`${modname}.${fieldname} not implemented.`);
	}
}

export class AbortError extends Error {
	constructor(msg = 'abort') {
		super(msg);
	}
}

export class AssertError extends Error {
	constructor(msg: string) {
		super(msg);
	}
}

export function assert(cond: any) {
	if (!cond) {
		throw new AssertError('assertion failed.');
	}
}
