import { describe, expect, it, vi } from 'vitest';

import { attachMonacoDebugActions, MonacoDebugView } from './monaco';

describe('MonacoDebugView', () => {
	it('keeps inline debug hints visible for empty end-of-line ranges', () => {
		const inlineValueDecorations = { set: vi.fn(), clear: vi.fn() };
		const breakpointDecorations = { set: vi.fn(), clear: vi.fn() };
		const editor = {
			createDecorationsCollection: vi
				.fn()
				.mockReturnValueOnce(breakpointDecorations)
				.mockReturnValueOnce(inlineValueDecorations),
			onMouseDown: vi.fn(() => ({ dispose: vi.fn() })),
			getModel: vi.fn(() => ({
				getLineMaxColumn: vi.fn(() => 14),
				getLineContent: vi.fn(() => '    sum += num;')
			})),
			getOption: vi.fn(() => ({ lineHeight: 20 })),
			getLayoutInfo: vi.fn(() => ({ contentWidth: 640 })),
			addContentWidget: vi.fn(),
			layoutContentWidget: vi.fn(),
			removeContentWidget: vi.fn(),
			revealLineInCenterIfOutsideViewport: vi.fn()
		};
		const Monaco = {
			Range: class {
				constructor(
					public startLineNumber: number,
					public startColumn: number,
					public endLineNumber: number,
					public endColumn: number
				) {}
			},
			editor: {
				EditorOption: { fontInfo: 50 },
				ContentWidgetPositionPreference: { EXACT: 0 },
				MouseTargetType: {
					GUTTER_GLYPH_MARGIN: 2,
					GUTTER_LINE_DECORATIONS: 3
				}
			}
		};
		const view = new MonacoDebugView(
			Monaco as never,
			editor as never,
			undefined
		);

		view.setPauseState(
			8,
			[
				{ name: 'sum', value: '55' },
				{ name: 'num', value: '11' }
			],
			{
				id: 'cpp',
				evaluateExpression: vi.fn(),
				selectInlineLocals: vi.fn((_, locals) => locals)
			}
		);

		expect(inlineValueDecorations.set).toHaveBeenCalledWith([
			expect.objectContaining({
				options: expect.objectContaining({
					showIfCollapsed: true,
					after: expect.objectContaining({
						content: '  sum = 55, num = 11',
						inlineClassName: 'debug-inline-values'
					})
				})
			})
		]);
	});

	it('registers cursor sync and run-to-cursor actions together for host editors', () => {
		let cursorHandler: ((event: { position?: { lineNumber?: number | null } | null }) => void) | null =
			null;
		const cursorDispose = vi.fn();
		const actionDispose = vi.fn();
		const onCursorLineChange = vi.fn();
		const onRunToCursor = vi.fn();
		const editor = {
			onDidChangeCursorPosition: vi.fn(
				(
					handler: (event: { position?: { lineNumber?: number | null } | null }) => void
				) => {
				cursorHandler = handler;
				return { dispose: cursorDispose };
				}
			),
			getPosition: vi.fn(() => ({ lineNumber: 13 })),
			addAction: vi.fn(({ run }) => {
				run();
				return { dispose: actionDispose };
			})
		};

		const bindings = attachMonacoDebugActions(editor as never, {
			onCursorLineChange,
			onRunToCursor
		});

		expect(onCursorLineChange).toHaveBeenNthCalledWith(1, 13);
		expect(editor.addAction).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'wasm-idle-run-to-cursor',
				label: 'Run to Cursor'
			})
		);
		expect(onRunToCursor).toHaveBeenCalledWith(13);

		expect(cursorHandler).not.toBeNull();
		if (!cursorHandler) {
			throw new Error('expected cursor handler');
		}
		(
			cursorHandler as (event: { position?: { lineNumber?: number | null } | null }) => void
		)({ position: { lineNumber: 21 } });
		expect(onCursorLineChange).toHaveBeenNthCalledWith(2, 21);

		bindings.dispose();

		expect(cursorDispose).toHaveBeenCalled();
		expect(actionDispose).toHaveBeenCalled();
		expect(onCursorLineChange).toHaveBeenLastCalledWith(null);
	});
});
