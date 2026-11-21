import type { editor, Uri } from 'monaco-editor';
import type { createOriginalLineEndings } from './workspace-model-eol';

/** These are the native text stack operations used by the pinned Monaco ModelService when it
 * reattaches a disposed document. The public model API has no history transfer between URIs. */
interface TextEdit {
	readonly resource: Uri;
	matchesResource(resource: Uri): boolean;
	setModel(model: editor.ITextModel | Uri): void;
	close(): void;
	redo(): void;
}
interface WorkspaceEdit {
	split?(): unknown[];
}
interface UndoService {
	getElements(resource: Uri): { past: unknown[]; future: unknown[] };
	removeElements(resource: Uri): void;
	pushElement(element: TextEdit): void;
	createSnapshot(resource: Uri): unknown;
}
interface NativeModel extends editor.ITextModel {
	readonly _undoRedoService: UndoService;
	_overwriteVersionId(version: number): void;
	_overwriteAlternativeVersionId(version: number): void;
	_overwriteInitialUndoRedoSnapshot(snapshot: unknown): void;
}

function documentEdit(entry: unknown, uri: Uri): TextEdit | undefined {
	if (!entry || typeof entry !== 'object') return;
	const edit = entry as Partial<TextEdit> & WorkspaceEdit;
	if (edit.resource && edit.matchesResource?.(uri) && edit.setModel && edit.close && edit.redo) {
		edit.close();
		// Closing freezes the native change bytes. Each URI owns its own element and model pointer.
		const copy = Object.assign(Object.create(Object.getPrototypeOf(edit)) as TextEdit, edit);
		copy.setModel(uri);
		return copy;
	}
	if (edit.split) {
		for (const part of edit.split()) {
			const local = documentEdit(part, uri);
			if (local) return local;
		}
	}
}

/** Save only contiguous native text edits. Inactive projects keep no live models or URI registrations. */
export function captureModelHistory(source: editor.ITextModel) {
	if (!source.canUndo() && !source.canRedo()) return;
	const from = source as NativeModel;
	const service = from._undoRedoService;
	const history = service.getElements(source.uri);
	function nearestFirst(entries: unknown[]) {
		const result: TextEdit[] = [];
		for (let i = entries.length - 1; i >= 0; i--) {
			const edit = documentEdit(entries[i], source.uri);
			// A non-text command is an undo boundary. Replaying changes across it is unsafe.
			if (!edit) break;
			result.push(edit);
		}
		return result;
	}
	const past = nearestFirst(history.past).reverse();
	const future = nearestFirst(history.future);
	return {
		past,
		future,
		eol: source.getEndOfLineSequence(),
		version: source.getVersionId(),
		alternativeVersion: source.getAlternativeVersionId()
	};
}

export type ProjectModelHistories = Map<
	string,
	{
		text: string;
		endings?: ReturnType<typeof createOriginalLineEndings>;
		history?: ReturnType<typeof captureModelHistory>;
		view?: editor.ICodeEditorViewState;
	}
>;

export function restoreModelHistory(
	target: editor.ITextModel,
	history: NonNullable<ReturnType<typeof captureModelHistory>>
) {
	const to = target as NativeModel;
	const service = to._undoRedoService;
	const { past, future } = history;
	target.setEOL(history.eol);
	const initial = service.createSnapshot(target.uri);
	for (const edit of past) {
		edit.setModel(target);
		service.pushElement(edit);
	}
	// Native push adds to the past stack. Rebuild forward groups on the detached target, then
	// return its bytes and cursor history to the current edit without touching the source.
	for (const edit of future) {
		edit.setModel(target);
		edit.redo();
		service.pushElement(edit);
	}
	for (let i = 0; i < future.length; i++) target.undo();
	to._overwriteVersionId(Math.max(history.version, target.getVersionId()));
	to._overwriteAlternativeVersionId(history.alternativeVersion);
	to._overwriteInitialUndoRedoSnapshot(initial);
}

/** Move text history to a renamed file's real URI while other documents stay live. */
export function moveModelHistory(source: editor.ITextModel, target: editor.ITextModel) {
	const history = captureModelHistory(source);
	if (!history) return;
	restoreModelHistory(target, history);
	(source as NativeModel)._undoRedoService.removeElements(source.uri);
}
