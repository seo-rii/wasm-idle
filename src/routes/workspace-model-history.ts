import type { editor, Uri } from 'monaco-editor';

/** These are the native text stack operations used by the pinned Monaco ModelService when it
 * reattaches a disposed document. The public model API has no history transfer between URIs. */
interface TextEdit {
	readonly resource: Uri;
	matchesResource(resource: Uri): boolean;
	setModel(model: editor.ITextModel): void;
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
		return Object.assign(Object.create(Object.getPrototypeOf(edit)) as TextEdit, edit);
	}
	if (edit.split) {
		for (const part of edit.split()) {
			const local = documentEdit(part, uri);
			if (local) return local;
		}
	}
}

/** Move contiguous text undo/redo groups to the new real file URI. Other documents stay live. */
export function moveModelHistory(source: editor.ITextModel, target: editor.ITextModel) {
	if (!source.canUndo() && !source.canRedo()) return;
	const from = source as NativeModel;
	const to = target as NativeModel;
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
	to._overwriteVersionId(Math.max(source.getVersionId(), target.getVersionId()));
	to._overwriteAlternativeVersionId(source.getAlternativeVersionId());
	to._overwriteInitialUndoRedoSnapshot(initial);
	service.removeElements(source.uri);
}
