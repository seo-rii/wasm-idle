import {
	DEFAULT_WORKSPACE_LIMITS,
	WorkspaceValidationError,
	normalizeWorkspacePath
} from '@wasm-idle/core';
import { CLANGD_CPP_FILE_PATH, CLANGD_WORKSPACE_PATH } from './config.js';

const textEncoder = new TextEncoder();
const workspacePrefix = `${CLANGD_WORKSPACE_PATH}/`;

export function normalizeClangdWorkspaceFilePath(path: string) {
	const relativePath = path.startsWith(workspacePrefix)
		? path.slice(workspacePrefix.length)
		: path;
	const normalizedPath = normalizeWorkspacePath(relativePath);
	const pathBytes = textEncoder.encode(normalizedPath).byteLength;
	if (pathBytes > DEFAULT_WORKSPACE_LIMITS.maxPathBytes) {
		throw new WorkspaceValidationError(
			'path-size-limit',
			`Clangd workspace path ${normalizedPath} is ${pathBytes} bytes; limit is ${DEFAULT_WORKSPACE_LIMITS.maxPathBytes}`,
			{
				path: normalizedPath,
				limit: DEFAULT_WORKSPACE_LIMITS.maxPathBytes,
				actual: pathBytes
			}
		);
	}
	return `${workspacePrefix}${normalizedPath}`;
}

export class ClangdWorkspaceFileRegistry {
	private readonly paths = new Set([CLANGD_CPP_FILE_PATH]);

	constructor(private readonly maxFiles = DEFAULT_WORKSPACE_LIMITS.maxFiles) {
		if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
			throw new WorkspaceValidationError(
				'invalid-limit',
				'Clangd workspace file limit must be a positive safe integer'
			);
		}
	}

	register(path: string) {
		const normalizedPath = normalizeClangdWorkspaceFilePath(path);
		if (this.paths.has(normalizedPath)) {
			return { path: normalizedPath, added: false } as const;
		}

		const nextFileCount = this.paths.size + 1;
		if (nextFileCount > this.maxFiles) {
			throw new WorkspaceValidationError(
				'file-count-limit',
				`Clangd workspace contains ${nextFileCount} files; limit is ${this.maxFiles}`,
				{ limit: this.maxFiles, actual: nextFileCount }
			);
		}
		this.paths.add(normalizedPath);
		return { path: normalizedPath, added: true } as const;
	}

	unregister(path: string) {
		if (path === CLANGD_CPP_FILE_PATH) return;
		this.paths.delete(path);
	}
}
