import {
	DEFAULT_WORKSPACE_LIMITS,
	WorkspaceValidationError,
	normalizeWorkspacePath,
	validateWorkspaceFiles
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

	constructor(private readonly maxFiles: number = DEFAULT_WORKSPACE_LIMITS.maxFiles) {
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

export interface ClangdWorkspaceFile {
	path: string;
	content: string;
}

export function prepareClangdWorkspace(files?: readonly ClangdWorkspaceFile[]) {
	if (files === undefined)
		return { registry: new ClangdWorkspaceFileRegistry(), files: undefined };
	if (!Array.isArray(files)) throw new TypeError('Clangd workspace files must be an array');
	// Match the website container's project limits. The synthetic main.cpp can occupy one extra slot.
	const limits = {
		maxFiles: 2048,
		maxFileBytes: 16 * 1024 * 1024,
		maxTotalBytes: 64 * 1024 * 1024,
		caseSensitive: true
	};
	const registry = new ClangdWorkspaceFileRegistry(limits.maxFiles + 1);
	const sources: ClangdWorkspaceFile[] = [];
	for (const { path, content } of validateWorkspaceFiles<ClangdWorkspaceFile>(files, limits)) {
		if (typeof content !== 'string')
			throw new TypeError('Clangd workspace files must contain text');
		// The language server and compiler share a managed compile profile.
		if (
			path
				.split('/')
				.some(
					(part) =>
						part === '.clangd' ||
						part === 'compile_commands.json' ||
						part === 'compile_flags.txt'
				)
		)
			continue;
		registry.register(path);
		sources.push({ path, content });
	}
	return { registry, files: sources };
}
