import { variables } from '../env';

/** Preserve mutable fixture overrides through the named public environment exports. */
export function mockPublicEnv(overrides: Record<string, string | undefined> = {}) {
	return Object.defineProperties(
		{},
		Object.fromEntries(
			Object.keys(variables).map((name) => [
				name,
				{ enumerable: true, get: () => overrides[name] }
			])
		)
	);
}
