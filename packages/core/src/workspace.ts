export type WorkspaceValidationErrorCode =
	| 'invalid-path'
	| 'duplicate-path'
	| 'case-collision'
	| 'file-count-limit'
	| 'file-size-limit'
	| 'total-size-limit'
	| 'path-size-limit'
	| 'invalid-content'
	| 'invalid-limit';

export class WorkspaceValidationError extends Error {
	readonly code: WorkspaceValidationErrorCode;
	readonly path?: string;
	readonly limit?: number;
	readonly actual?: number;

	constructor(
		code: WorkspaceValidationErrorCode,
		message: string,
		details: { path?: string; limit?: number; actual?: number } = {}
	) {
		super(message);
		this.name = 'WorkspaceValidationError';
		this.code = code;
		this.path = details.path;
		this.limit = details.limit;
		this.actual = details.actual;
	}
}

export interface WorkspaceFile {
	path: string;
	content: string | Uint8Array;
}

export interface WorkspaceLimits {
	maxFiles: number;
	maxFileBytes: number;
	maxTotalBytes: number;
	maxPathBytes: number;
	caseSensitive: boolean;
}

export const DEFAULT_WORKSPACE_LIMITS = Object.freeze({
	maxFiles: 256,
	maxFileBytes: 2 * 1024 * 1024,
	maxTotalBytes: 8 * 1024 * 1024,
	maxPathBytes: 1024,
	caseSensitive: false
}) satisfies Readonly<WorkspaceLimits>;

const textEncoder = new TextEncoder();
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function normalizeWorkspacePath(path: string): string {
	if (
		typeof path !== 'string' ||
		path.length === 0 ||
		path.startsWith('/') ||
		path.startsWith('\\') ||
		URL_SCHEME.test(path) ||
		CONTROL_CHARACTER.test(path)
	) {
		throw new WorkspaceValidationError('invalid-path', `Invalid workspace path: ${path}`, {
			path
		});
	}

	const normalized = path.replaceAll('\\', '/');
	const segments = normalized.split('/');
	if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
		throw new WorkspaceValidationError('invalid-path', `Invalid workspace path: ${path}`, {
			path
		});
	}
	return normalized;
}

const requireLimit = (name: keyof Omit<WorkspaceLimits, 'caseSensitive'>, value: number) => {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new WorkspaceValidationError(
			'invalid-limit',
			`Workspace limit ${name} must be a non-negative safe integer`
		);
	}
	return value;
};

const resolveWorkspaceLimits = (limits: Partial<WorkspaceLimits>): WorkspaceLimits => ({
	maxFiles: requireLimit('maxFiles', limits.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles),
	maxFileBytes: requireLimit(
		'maxFileBytes',
		limits.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes
	),
	maxTotalBytes: requireLimit(
		'maxTotalBytes',
		limits.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes
	),
	maxPathBytes: requireLimit(
		'maxPathBytes',
		limits.maxPathBytes ?? DEFAULT_WORKSPACE_LIMITS.maxPathBytes
	),
	caseSensitive: limits.caseSensitive ?? DEFAULT_WORKSPACE_LIMITS.caseSensitive
});

const contentByteLength = (file: WorkspaceFile) => {
	if (typeof file.content === 'string') return textEncoder.encode(file.content).byteLength;
	if (file.content instanceof Uint8Array) return file.content.byteLength;
	throw new WorkspaceValidationError(
		'invalid-content',
		`Workspace file ${file.path} must contain a string or Uint8Array`,
		{ path: file.path }
	);
};

export function validateWorkspaceFiles<T extends WorkspaceFile>(
	files: readonly T[],
	limits: Partial<WorkspaceLimits> = {}
): Array<T & { path: string }> {
	const resolvedLimits = resolveWorkspaceLimits(limits);
	if (files.length > resolvedLimits.maxFiles) {
		throw new WorkspaceValidationError(
			'file-count-limit',
			`Workspace contains ${files.length} files; limit is ${resolvedLimits.maxFiles}`,
			{ limit: resolvedLimits.maxFiles, actual: files.length }
		);
	}

	const exactPaths = new Set<string>();
	const foldedPaths = new Map<string, string>();
	let totalBytes = 0;
	return files.map((file) => {
		const path = normalizeWorkspacePath(file.path);
		const pathBytes = textEncoder.encode(path).byteLength;
		if (pathBytes > resolvedLimits.maxPathBytes) {
			throw new WorkspaceValidationError(
				'path-size-limit',
				`Workspace path ${path} is ${pathBytes} bytes; limit is ${resolvedLimits.maxPathBytes}`,
				{ path, limit: resolvedLimits.maxPathBytes, actual: pathBytes }
			);
		}
		if (exactPaths.has(path)) {
			throw new WorkspaceValidationError(
				'duplicate-path',
				`Duplicate workspace path: ${path}`,
				{
					path
				}
			);
		}
		exactPaths.add(path);

		if (!resolvedLimits.caseSensitive) {
			const foldedPath = path.toLowerCase();
			const existing = foldedPaths.get(foldedPath);
			if (existing && existing !== path) {
				throw new WorkspaceValidationError(
					'case-collision',
					`Workspace paths differ only by case: ${existing} and ${path}`,
					{ path }
				);
			}
			foldedPaths.set(foldedPath, path);
		}

		const fileBytes = contentByteLength(file);
		if (fileBytes > resolvedLimits.maxFileBytes) {
			throw new WorkspaceValidationError(
				'file-size-limit',
				`Workspace file ${path} is ${fileBytes} bytes; limit is ${resolvedLimits.maxFileBytes}`,
				{ path, limit: resolvedLimits.maxFileBytes, actual: fileBytes }
			);
		}
		totalBytes += fileBytes;
		if (totalBytes > resolvedLimits.maxTotalBytes) {
			throw new WorkspaceValidationError(
				'total-size-limit',
				`Workspace is ${totalBytes} bytes; limit is ${resolvedLimits.maxTotalBytes}`,
				{ limit: resolvedLimits.maxTotalBytes, actual: totalBytes }
			);
		}

		return { ...file, path };
	});
}
