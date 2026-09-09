import 'vitest';

declare module 'vitest' {
	interface TaskMeta {
		browser?: boolean;
		requiredBrowser?: boolean;
	}
}
