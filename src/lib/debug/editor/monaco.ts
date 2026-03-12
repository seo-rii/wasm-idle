import type { DebugVariable } from '$lib/playground/options';
import type { DebugLanguageAdapter } from '$lib/debug/language';
import type monaco from 'monaco-editor';

export class MonacoDebugView {
	Monaco: typeof monaco;
	editor: monaco.editor.IStandaloneCodeEditor;
	breakpointDecorations: monaco.editor.IEditorDecorationsCollection;
	inlineValueDecorations: monaco.editor.IEditorDecorationsCollection;
	pausedLineWidget: monaco.editor.IContentWidget | null = null;
	pausedLineWidgetNode: HTMLDivElement | null = null;
	mouseHandler: monaco.IDisposable | null = null;
	breakpoints: number[] = [];
	onBreakpointsChange?: (lines: number[]) => void;

	constructor(
		MonacoModule: typeof monaco,
		editor: monaco.editor.IStandaloneCodeEditor,
		onBreakpointsChange?: (lines: number[]) => void
	) {
		this.Monaco = MonacoModule;
		this.editor = editor;
		this.onBreakpointsChange = onBreakpointsChange;
		this.breakpointDecorations = editor.createDecorationsCollection();
		this.inlineValueDecorations = editor.createDecorationsCollection();
		this.mouseHandler = editor.onMouseDown((event) => {
			if (
				event.target.type !== this.Monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
				event.target.type !== this.Monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
			) {
				return;
			}
			const line = event.target.position?.lineNumber;
			if (!line) return;
			const next = this.breakpoints.includes(line)
				? this.breakpoints.filter((value) => value !== line)
				: [...this.breakpoints, line].sort((a, b) => a - b);
			this.onBreakpointsChange?.(next);
		});
	}

	setBreakpoints(lines: number[]) {
		this.breakpoints = lines;
		this.breakpointDecorations.set(
			lines.map((line) => ({
				range: new this.Monaco.Range(line, 1, line, 1),
				options: {
					isWholeLine: false,
					glyphMarginClassName: 'debug-breakpoint-glyph',
					glyphMarginHoverMessage: { value: 'Breakpoint' }
				}
			}))
		);
	}

	setPauseState(
		pausedLine: number | null,
		locals: DebugVariable[],
		adapter: DebugLanguageAdapter | null
	) {
		const lineMaxColumn = pausedLine ? this.editor.getModel()?.getLineMaxColumn(pausedLine) || 1 : 1;
		if (pausedLine) {
			const fontInfo = this.editor.getOption(this.Monaco.editor.EditorOption.fontInfo);
			if (!this.pausedLineWidgetNode) {
				this.pausedLineWidgetNode = document.createElement('div');
				this.pausedLineWidgetNode.className = 'debug-paused-line-widget';
			}
			this.pausedLineWidgetNode.style.height = `${fontInfo.lineHeight}px`;
			this.pausedLineWidgetNode.style.width = `${this.editor.getLayoutInfo().contentWidth}px`;
			if (!this.pausedLineWidget) {
				this.pausedLineWidget = {
					getId: () => 'wasm-idle-debug-current-line',
					getDomNode: () => this.pausedLineWidgetNode!,
					getPosition: () => ({
						position: { lineNumber: pausedLine, column: 1 },
						preference: [this.Monaco.editor.ContentWidgetPositionPreference.EXACT]
					})
				};
				this.editor.addContentWidget(this.pausedLineWidget);
			} else {
				this.editor.layoutContentWidget(this.pausedLineWidget);
			}
			this.editor.revealLineInCenterIfOutsideViewport(pausedLine);
		} else if (this.pausedLineWidget) {
			this.editor.removeContentWidget(this.pausedLineWidget);
			this.pausedLineWidget = null;
			this.pausedLineWidgetNode = null;
		}
		const inlineLocals =
			pausedLine && adapter
				? adapter.selectInlineLocals(
						this.editor.getModel()?.getLineContent(pausedLine) || '',
						locals
					)
				: [];
		this.inlineValueDecorations.set(
			pausedLine && inlineLocals.length
				? [
						{
							range: new this.Monaco.Range(pausedLine, lineMaxColumn, pausedLine, lineMaxColumn),
							options: {
								showIfCollapsed: true,
								after: {
									content: `  ${inlineLocals
										.map((variable) => `${variable.name} = ${variable.value}`)
										.join(', ')}`,
									inlineClassName: 'debug-inline-values',
									inlineClassNameAffectsLetterSpacing: true
								},
								zIndex: 20
							}
						}
					]
				: []
		);
	}

	dispose() {
		this.breakpointDecorations.clear();
		this.inlineValueDecorations.clear();
		if (this.pausedLineWidget) this.editor.removeContentWidget(this.pausedLineWidget);
		this.pausedLineWidget = null;
		this.pausedLineWidgetNode = null;
		this.mouseHandler?.dispose();
		this.mouseHandler = null;
	}
}
