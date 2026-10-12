import { describe, expect, it } from 'vitest';
import {
	editorDefaults,
	legacyBrokenFsharpEditorDefault,
	legacyBrokenTinyGoEditorDefault
} from './editor-defaults';
import { migrateLegacyWorkspaceFile } from './workspaceMigration';

describe('workspace starter migration', () => {
	it('preserves source that happens to match another language starter', () => {
		const helper = { path: 'helper.py', content: editorDefaults.python };
		expect(
			migrateLegacyWorkspaceFile(helper, {
				version: 5,
				language: 'CPP',
				entryPath: 'main.cpp',
				defaultSource: editorDefaults.cpp
			})
		).toEqual(helper);
	});

	it.each([
		['TINYGO', 'main.go', legacyBrokenTinyGoEditorDefault, editorDefaults.go],
		['FSHARP', 'main.fs', legacyBrokenFsharpEditorDefault, editorDefaults.fsharp]
	])(
		'updates only the %s legacy entry in an explicit older schema',
		(language, entryPath, legacy, current) => {
			const file = { path: entryPath, content: legacy };
			const options = { version: 5, language, entryPath, defaultSource: current };
			expect(migrateLegacyWorkspaceFile(file, options)).toEqual({
				path: entryPath,
				content: current
			});
			for (const version of [undefined, 0, 6, 7, 4.5]) {
				expect(migrateLegacyWorkspaceFile(file, { ...options, version })).toEqual(file);
			}
			const helper = { path: `subdir/${entryPath}`, content: legacy };
			expect(migrateLegacyWorkspaceFile(helper, options)).toEqual(helper);
			const edited = { path: entryPath, content: `${legacy}\n// user edit` };
			expect(migrateLegacyWorkspaceFile(edited, options)).toEqual(edited);
		}
	);
});
