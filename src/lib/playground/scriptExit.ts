/** A program completed normally through its language's nonzero process-exit API. */
export class ScriptExitError extends Error {
	readonly name = 'ScriptExitError';

	constructor(readonly exitCode: number) {
		super(`Program exited with code ${exitCode}`);
	}
}
