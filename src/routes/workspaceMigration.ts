import {
	legacyBrokenFsharpEditorDefault,
	legacyBrokenTinyGoEditorDefault
} from './editor-defaults';
import { isBinaryWorkspaceFile, type WorkspaceFile } from './workspaceCodec';

/** Only identified legacy starters may be updated while restoring an older schema. */
export function migrateLegacyWorkspaceFile(
	file: WorkspaceFile,
	options: { version?: number; language: string; entryPath: string; defaultSource: string }
): WorkspaceFile {
	const legacySource =
		options.language === 'TINYGO'
			? legacyBrokenTinyGoEditorDefault
			: options.language === 'FSHARP'
				? legacyBrokenFsharpEditorDefault
				: undefined;
	if (
		typeof options.version === 'number' &&
		Number.isInteger(options.version) &&
		options.version >= 1 &&
		options.version < 6 &&
		file.path === options.entryPath &&
		!isBinaryWorkspaceFile(file) &&
		legacySource !== undefined &&
		file.content === legacySource
	) {
		return { ...file, content: options.defaultSource };
	}
	return { ...file };
}
