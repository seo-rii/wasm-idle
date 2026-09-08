import { describe, expect, it, vi } from 'vitest';

import { attachMonacoDebugActions, MonacoDebugView } from '../../src/editor/monaco.js';

describe('MonacoDebugView', () => {
	it('ignores a paused line outside the active editor model', () => {
		const inlineValueDecorations = { set: vi.fn(), clear: vi.fn() };
		const breakpointDecorations = { set: vi.fn(), clear: vi.fn() };
		const getLineMaxColumn = vi.fn(() => {
			throw new Error('Illegal value for lineNumber');
		});
		const editor = {
			createDecorationsCollection: vi
				.fn()
				.mockReturnValueOnce(breakpointDecorations)
				.mockReturnValueOnce(inlineValueDecorations),
			onMouseDown: vi.fn(() => ({ dispose: vi.fn() })),
			getModel: vi.fn(() => ({
				getLineCount: vi.fn(() => 5),
				getLineMaxColumn,
				getLineContent: vi.fn()
			})),
			getOption: vi.fn(() => ({ lineHeight: 20 })),
			getLayoutInfo: vi.fn(() => ({ contentWidth: 640 })),
			addContentWidget: vi.fn(),
			layoutContentWidget: vi.fn(),
			removeContentWidget: vi.fn(),
			revealLineInCenterIfOutsideViewport: vi.fn()
		};
		const Monaco = {
			Range: class {},
			editor: {
				EditorOption: { fontInfo: 50 },
				ContentWidgetPositionPreference: { EXACT: 0 },
				MouseTargetType: {
					GUTTER_GLYPH_MARGIN: 2,
					GUTTER_LINE_DECORATIONS: 3
				}
			}
		};
		const view = new MonacoDebugView(Monaco as never, editor as never, undefined);

		expect(() => view.setPauseState(42, [], null)).not.toThrow();
		expect(getLineMaxColumn).not.toHaveBeenCalled();
		expect(editor.addContentWidget).not.toHaveBeenCalled();
		expect(inlineValueDecorations.set).toHaveBeenCalledWith([]);
	});

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
				getLineCount: vi.fn(() => 20),
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
		const view = new MonacoDebugView(Monaco as never, editor as never, undefined);

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

	it('moves the same pause widget when selecting another frame and updates its locals', () => {
		const breakpointDecorations = { set: vi.fn(), clear: vi.fn() };
		const inlineValueDecorations = { set: vi.fn(), clear: vi.fn() };
		const mouseDispose = vi.fn();
		const onBreakpointsChange = vi.fn();
		const editor = {
			createDecorationsCollection: vi
				.fn()
				.mockReturnValueOnce(breakpointDecorations)
				.mockReturnValueOnce(inlineValueDecorations),
			onMouseDown: vi.fn(
				(
					_handler: (event: {
						target: { type: number; position: { lineNumber: number } };
					}) => void
				) => ({
					dispose: mouseDispose
				})
			),
			getModel: vi.fn(() => ({
				getLineCount: () => 20,
				getLineMaxColumn: () => 14,
				getLineContent: () => 'value += 1;'
			})),
			getOption: () => ({ lineHeight: 20 }),
			getLayoutInfo: () => ({ contentWidth: 640 }),
			addContentWidget: vi.fn(),
			layoutContentWidget: vi.fn(),
			removeContentWidget: vi.fn(),
			revealLineInCenterIfOutsideViewport: vi.fn()
		};
		const Monaco = {
			Range: class {
				constructor(public startLineNumber: number) {}
			},
			editor: {
				EditorOption: { fontInfo: 50 },
				ContentWidgetPositionPreference: { EXACT: 0 },
				MouseTargetType: { GUTTER_GLYPH_MARGIN: 2, GUTTER_LINE_DECORATIONS: 3 }
			}
		};
		const adapter = {
			id: 'cpp',
			evaluateExpression: vi.fn(),
			selectInlineLocals: vi.fn((_, locals) => locals)
		};
		const view = new MonacoDebugView(Monaco as never, editor as never, onBreakpointsChange);
		view.setBreakpoints([8]);
		view.setPauseState(8, [{ name: 'value', value: '1' }], adapter);
		const widget = view.pausedLineWidget!;
		const node = widget.getDomNode();
		expect(widget.getPosition()?.position).toEqual({ lineNumber: 8, column: 1 });

		view.setBreakpoints([12]);
		view.setPauseState(12, [{ name: 'value', value: '2' }], adapter);
		expect(view.pausedLineWidget).toBe(widget);
		expect(widget.getDomNode()).toBe(node);
		expect(widget.getPosition()?.position).toEqual({ lineNumber: 12, column: 1 });
		expect(editor.addContentWidget).toHaveBeenCalledTimes(1);
		expect(editor.layoutContentWidget).toHaveBeenCalledWith(widget);
		expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenLastCalledWith(12);
		expect(inlineValueDecorations.set).toHaveBeenLastCalledWith([
			expect.objectContaining({
				range: expect.objectContaining({ startLineNumber: 12 }),
				options: expect.objectContaining({
					after: expect.objectContaining({ content: '  value = 2' })
				})
			})
		]);
		const mouseHandler = editor.onMouseDown.mock.calls[0][0];
		mouseHandler({ target: { type: 2, position: { lineNumber: 12 } } });
		expect(onBreakpointsChange).toHaveBeenLastCalledWith([]);
		mouseHandler({ target: { type: 2, position: { lineNumber: 9 } } });
		expect(onBreakpointsChange).toHaveBeenLastCalledWith([9, 12]);

		view.setPauseState(null, [], adapter);
		expect(editor.removeContentWidget).toHaveBeenCalledWith(widget);
		expect(widget.getPosition()?.position).toBeNull();
		expect(inlineValueDecorations.set).toHaveBeenLastCalledWith([]);
		view.setPauseState(5, [], adapter);
		expect(view.pausedLineWidget?.getPosition()?.position).toEqual({
			lineNumber: 5,
			column: 1
		});
		expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(2);
		expect(editor.onMouseDown).toHaveBeenCalledTimes(1);
		expect(mouseDispose).not.toHaveBeenCalled();

		view.dispose();
		expect(breakpointDecorations.clear).toHaveBeenCalledOnce();
		expect(inlineValueDecorations.clear).toHaveBeenCalledOnce();
		expect(mouseDispose).toHaveBeenCalledOnce();
		expect(view.pausedLineWidget).toBeNull();
	});

	it('registers cursor sync and run-to-cursor actions together for host editors', () => {
		let cursorHandler:
			| ((event: { position?: { lineNumber?: number | null } | null }) => void)
			| null = null;
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
		(cursorHandler as (event: { position?: { lineNumber?: number | null } | null }) => void)({
			position: { lineNumber: 21 }
		});
		expect(onCursorLineChange).toHaveBeenNthCalledWith(2, 21);

		bindings.dispose();

		expect(cursorDispose).toHaveBeenCalled();
		expect(actionDispose).toHaveBeenCalled();
		expect(onCursorLineChange).toHaveBeenLastCalledWith(null);
	});
});
